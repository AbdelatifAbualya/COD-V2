
// netlify/functions/api-proxy.js
const fetch = require('node-fetch');
const { AbortController } = require('abort-controller');

exports.handler = async function(event, context) {
  // Set CORS headers for preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.log('Method not allowed:', event.httpMethod);
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }

  try {
    // Check if API keys are set - explicitly check for QROQ_API_KEY first since that's what the user set
    const apiKey = process.env.QROQ_API_KEY || process.env.GROQ_API_KEY || process.env.API_KEY;
    const toolhouseApiKey = process.env.TOOLHOUSE_API_KEY;
    
    if (!apiKey) {
      console.error('No API key found in environment variables');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'API key not configured',
          message: 'Please set QROQ_API_KEY in your Netlify environment variables'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Parse the request body
    const requestBody = JSON.parse(event.body);
    console.log('Request received for model:', requestBody.model);
    
    // Check if web search is enabled
    const enableWebSearch = requestBody.enableWebSearch === true;
    console.log(`Web search enabled: ${enableWebSearch}`);
    
    // Check if the Toolhouse API key is available when web search is requested
    if (enableWebSearch && !toolhouseApiKey) {
      console.error('Web search requested but no Toolhouse API key found');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Toolhouse API key not configured',
          message: 'Please set TOOLHOUSE_API_KEY in your Netlify environment variables to use web search'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }
    
    // Handle the request based on whether web search is enabled
    if (enableWebSearch && toolhouseApiKey) {
      return await handleToolhouseWebSearch(apiKey, toolhouseApiKey, requestBody);
    } else {
      return await handleStandardGroqRequest(apiKey, requestBody);
    }
    
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message || 'Unknown error occurred',
        details: {
          name: error.name,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          suggestions: [
            "Verify QROQ_API_KEY is set correctly in Netlify environment variables",
            "If using web search, ensure TOOLHOUSE_API_KEY is set correctly",
            "Check if the model name is valid for Groq API",
            "Ensure network connection is stable",
            "Verify your Groq API subscription is active"
          ]
        }
      }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }
};

/**
 * Handle a standard Groq API request (no tools)
 */
async function handleStandardGroqRequest(apiKey, requestBody) {
  const apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
  console.log('Using standard Groq API endpoint');
  
  // Create a clean copy of the request body without enableWebSearch
  const cleanRequestBody = { ...requestBody };
  delete cleanRequestBody.enableWebSearch;
  console.log('Removed enableWebSearch field from request to Groq API');
  
  // Implement retry logic
  let retries = 3;
  let response;
  
  while (retries > 0) {
    try {
      // Set up abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout
      
      // Make a request to the Groq API
      console.log(`Sending request to Groq API (attempts remaining: ${retries})`);
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(cleanRequestBody),
        signal: controller.signal
      });
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // If we get a 502, retry; otherwise, break the loop
      if (response.status === 502) {
        console.log('Received 502 from Groq API, retrying...');
        retries--;
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, (3 - retries) * 2000));
      } else {
        // For any other status (success or other errors), break the retry loop
        break;
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      retries--;
      if (retries === 0) throw fetchError;
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, (3 - retries) * 2000));
    }
  }

  // If we exhausted retries and still don't have a response
  if (!response) {
    throw new Error('Failed to get response from Groq API after multiple attempts');
  }

  // Handle response errors
  if (!response.ok) {
    const errorData = await response.text();
    console.error(`Groq API error: ${response.status}`, errorData);
    
    let errorMessage;
    try {
      // Try to parse error as JSON
      const parsedError = JSON.parse(errorData);
      errorMessage = parsedError.error?.message || 'Unknown API error';
    } catch {
      // If parsing fails, use the raw text
      errorMessage = errorData || `Error ${response.status}`;
    }
    
    // Special error message for 401 errors
    if (response.status === 401) {
      errorMessage = "Authentication failed. Please check your QROQ_API_KEY value in Netlify environment variables.";
    }
    
    return {
      statusCode: response.status,
      body: JSON.stringify({ 
        error: `Groq API error: ${response.status}`,
        message: errorMessage,
        details: {
          possible_fixes: [
            "Verify the API key is correct in Netlify",
            "Check that the model name is valid for Groq API (try llama-3-8b or mixtral-8x7b-32768)",
            "Ensure your Groq API subscription is active"
          ]
        }
      }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }

  // Parse the response
  const data = await response.json();
  console.log('Received successful response from Groq API');

  // Return the response
  return {
    statusCode: 200,
    body: JSON.stringify(data),
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  };
}

/**
 * Handle a request with Toolhouse web search
 */
async function handleToolhouseWebSearch(apiKey, toolhouseApiKey, requestBody) {
  const groqApiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const toolhouseApiEndpoint = 'https://api.toolhouse.io/v1';
  
  console.log('Setting up Toolhouse web search capability');
  
  try {
    // 1. Get the Toolhouse web search tool
    console.log('Fetching available tools from Toolhouse');
    const toolsResponse = await fetch(`${toolhouseApiEndpoint}/tools`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${toolhouseApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!toolsResponse.ok) {
      const errorData = await toolsResponse.text();
      console.error(`Toolhouse API error: ${toolsResponse.status}`, errorData);
      throw new Error(`Toolhouse API error: ${toolsResponse.status} - ${errorData}`);
    }
    
    const toolsData = await toolsResponse.json();
    console.log(`Retrieved ${toolsData.data.length} tools from Toolhouse`);
    
    // Find the web search tool
    const webSearchTool = toolsData.data.find(tool => tool.type === 'function' && 
                                               tool.function && 
                                               tool.function.name === 'web_search');
    
    if (!webSearchTool) {
      throw new Error('Web search tool not found in Toolhouse tools');
    }
    
    console.log('Found web search tool:', webSearchTool.id);
    
    // 2. Prepare the request for Groq with the web search tool
    const toolsForGroq = [webSearchTool];
    
    // Clone the request body to avoid mutating the original
    const modifiedRequestBody = {
      ...requestBody,
      tools: toolsForGroq
    };
    
    // Remove enableWebSearch flag as it's not needed by Groq
    delete modifiedRequestBody.enableWebSearch;
    
    // 3. First call - Get the tool function call from the LLM
    console.log('Sending first request to Groq with web search tool');
    let response = await fetch(groqApiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(modifiedRequestBody)
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Groq API error: ${response.status}`, errorData);
      
      let errorMessage;
      try {
        // Try to parse error as JSON
        const parsedError = JSON.parse(errorData);
        errorMessage = parsedError.error?.message || 'Unknown API error';
      } catch {
        // If parsing fails, use the raw text
        errorMessage = errorData || `Error ${response.status}`;
      }
      
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: `Groq API error: ${response.status}`,
          message: errorMessage,
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }
    
    let responseData = await response.json();
    
    // 4. Check if the LLM wants to use the web search tool
    if (responseData.choices && 
        responseData.choices[0] && 
        responseData.choices[0].message && 
        responseData.choices[0].message.tool_calls &&
        responseData.choices[0].message.tool_calls.length > 0) {
      
      console.log('LLM requested to use web search tool');
      
      // Process all tool calls (may be more than one)
      const messageHistory = [...requestBody.messages];
      
      // Add the assistant's response with tool_calls
      messageHistory.push(responseData.choices[0].message);
      
      // Execute all requested tool calls
      for (const toolCall of responseData.choices[0].message.tool_calls) {
        if (toolCall.function && toolCall.function.name === 'web_search') {
          console.log('Executing web search with query:', toolCall.function.arguments);
          
          // Parse the arguments
          let searchArgs;
          try {
            searchArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('Error parsing search arguments:', e);
            
            // Try to extract query if it's a simple string
            if (typeof toolCall.function.arguments === 'string') {
              const match = toolCall.function.arguments.match(/"query":\s*"([^"]+)"/);
              if (match) {
                searchArgs = { query: match[1] };
              } else {
                searchArgs = { query: toolCall.function.arguments.replace(/"/g, '') };
              }
            } else {
              searchArgs = { query: "error parsing search query" };
            }
          }
          
          console.log('Parsed search arguments:', searchArgs);
          
          // Call Toolhouse API to execute the web search
          console.log('Calling Toolhouse to execute web search');
          const toolExecResponse = await fetch(`${toolhouseApiEndpoint}/tools/execute`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${toolhouseApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              tool_id: webSearchTool.id,
              arguments: searchArgs
            })
          });
          
          if (!toolExecResponse.ok) {
            const errorData = await toolExecResponse.text();
            console.error(`Toolhouse execution error: ${toolExecResponse.status}`, errorData);
            throw new Error(`Toolhouse execution error: ${toolExecResponse.status} - ${errorData}`);
          }
          
          const searchResults = await toolExecResponse.json();
          console.log('Web search results received');
          
          // Add the tool results to message history
          messageHistory.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(searchResults)
          });
        }
      }
      
      // 5. Second call - Get the final response incorporating web search results
      console.log('Sending second request to Groq with search results');
      const finalResponse = await fetch(groqApiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: requestBody.model,
          messages: messageHistory,
          temperature: requestBody.temperature || 0.7,
          top_p: requestBody.top_p || 0.9,
          max_tokens: requestBody.max_tokens || 1024
        })
      });
      
      if (!finalResponse.ok) {
        const errorData = await finalResponse.text();
        console.error(`Groq API error (final response): ${finalResponse.status}`, errorData);
        
        let errorMessage;
        try {
          // Try to parse error as JSON
          const parsedError = JSON.parse(errorData);
          errorMessage = parsedError.error?.message || 'Unknown API error';
        } catch {
          // If parsing fails, use the raw text
          errorMessage = errorData || `Error ${finalResponse.status}`;
        }
        
        return {
          statusCode: finalResponse.status,
          body: JSON.stringify({ 
            error: `Groq API error: ${finalResponse.status}`,
            message: errorMessage,
          }),
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        };
      }
      
      const finalData = await finalResponse.json();
      console.log('Received final response with web search results');
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          ...finalData,
          search_info: { used: true }
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    } else {
      // If no tool calls, just return the original response
      console.log('LLM did not use web search tool, returning standard response');
      return {
        statusCode: 200,
        body: JSON.stringify({
          ...responseData,
          search_info: { used: false, message: "The model chose not to use web search for this query" }
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }
  } catch (error) {
    console.error('Toolhouse web search error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Toolhouse web search error',
        message: error.message,
        details: {
          name: error.name,
          suggestions: [
            "Verify TOOLHOUSE_API_KEY is set correctly",
            "Check if the Toolhouse service is available",
            "Try reformulating your query"
          ]
        }
      }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }
}
