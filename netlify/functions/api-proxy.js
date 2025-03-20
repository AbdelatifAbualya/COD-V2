// netlify/functions/api-proxy.js
const fetch = require('node-fetch');
const { AbortController } = require('abort-controller');

exports.handler = async function(event, context) {
  // Log the incoming request details
  console.log('Incoming request:', {
    method: event.httpMethod,
    headers: event.headers,
    body: event.body ? JSON.parse(event.body) : null
  });

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
    // Validate request body
    if (!event.body) {
      console.error('No request body provided');
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Bad Request',
          message: 'Request body is required'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Bad Request',
          message: 'Invalid JSON in request body'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Validate required fields
    if (!requestBody.model) {
      console.error('No model specified in request');
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Bad Request',
          message: 'Model name is required'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      console.error('Invalid or empty messages array');
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Bad Request',
          message: 'Messages array is required and must not be empty'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Check if API keys are set
    const groqApiKey = process.env.QROQ_API_KEY || process.env.GROQ_API_KEY || process.env.API_KEY;
    const toolhouseApiKey = process.env.TOOLHOUSE_API_KEY;
    
    if (!groqApiKey) {
      console.error('No Groq API key found in environment variables');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Groq API key not configured',
          message: 'Please set GROQ_API_KEY in your Netlify environment variables'
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Log the validated request
    console.log('Validated request:', {
      model: requestBody.model,
      messageCount: requestBody.messages.length,
      enableWebSearch: requestBody.enableWebSearch
    });

    // Parse the request body
    const modelName = requestBody.model;
    console.log('Request received for model:', modelName);
    
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
    
    // Check if this is a vision model
    const isVisionModel = modelName && (
      modelName.includes('vision') || 
      modelName.includes('llava') || 
      modelName.includes('claude-3') ||
      modelName.includes('gemini')
    );
    
    console.log(`Model ${modelName} is ${isVisionModel ? 'a vision model' : 'not a vision model'}`);
    
    // Process any images in the request for vision models
    if (isVisionModel && requestBody.messages) {
      requestBody.messages = processImagesInMessages(requestBody.messages);
      console.log('Processed images in messages for vision model');
    }
    
    // Handle the request based on whether web search is enabled
    if (enableWebSearch && toolhouseApiKey) {
      return await handleToolhouseWebSearch(groqApiKey, toolhouseApiKey, requestBody);
    } else {
      return await handleStandardGroqRequest(groqApiKey, requestBody);
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
            "Verify GROQ_API_KEY is set correctly in Netlify environment variables",
            "If using web search, ensure TOOLHOUSE_API_KEY is set correctly",
            "Check if the model name is valid for Groq API",
            "Ensure network connection is stable",
            "Verify API subscriptions are active"
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
  
  // Implement retry logic
  let retries = 3;
  let response;
  
  while (retries > 0) {
    try {
      // Set up abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout
      
      // Log request size for debugging
      const requestSize = JSON.stringify(requestBody).length;
      console.log(`Request size: ${requestSize} bytes`);
      
      // Make a request to the Groq API
      console.log(`Sending request to Groq API (attempts remaining: ${retries})`);
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
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

  return await processApiResponse(response, requestBody.model);
}

/**
 * Handle a request with Toolhouse web search
 */
async function handleToolhouseWebSearch(groqApiKey, toolhouseApiKey, requestBody) {
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
        'Authorization': `Bearer ${groqApiKey}`
      },
      body: JSON.stringify(modifiedRequestBody)
    });
    
    if (!response.ok) {
      return await processApiResponse(response, requestBody.model);
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
          console.log('Web search results received, first few results:', 
            JSON.stringify(searchResults.slice(0, 2)));
          
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
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model: requestBody.model,
          messages: messageHistory,
          temperature: requestBody.temperature || 0.7,
          top_p: requestBody.top_p || 0.9,
          max_tokens: requestBody.max_tokens || 128000  // Increased to 128K tokens
        })
      });
      
      return await processApiResponse(finalResponse, requestBody.model);
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
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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

/**
 * Process API responses and handle errors
 */
async function processApiResponse(response, modelName) {
  console.log(`Processing API response for model ${modelName}`);
  console.log('Response status:', response.status);
  
  const responseHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const responseText = await response.text();
    console.log('Raw response:', responseText);
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse API response:', parseError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Invalid API Response',
          message: 'The API returned an invalid JSON response',
          details: responseText
        }),
        headers: responseHeaders
      };
    }

    if (!response.ok) {
      console.error('API error response:', responseData);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: responseData.error || 'API Error',
          message: responseData.message || 'An error occurred while processing your request',
          details: responseData
        }),
        headers: responseHeaders
      };
    }

    return {
      statusCode: 200,
      body: responseText,
      headers: responseHeaders
    };
  } catch (error) {
    console.error('Error processing API response:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Response Processing Error',
        message: 'Failed to process the API response',
        details: error.message
      }),
      headers: responseHeaders
    };
  }
}

/**
 * Process images in messages to ensure they're in the correct format for the API
 * @param {Array} messages - Array of message objects
 * @returns {Array} - Processed messages
 */
function processImagesInMessages(messages) {
  return messages.map(message => {
    // Only process user messages with content array
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map(item => {
          if (item.type === 'image_url' && item.image_url) {
            // Process data URLs
            if (item.image_url.url && item.image_url.url.startsWith('data:')) {
              const match = item.image_url.url.match(/^data:(.+?);base64,(.+)$/);
              if (match) {
                const [_, mimeType, base64Data] = match;
                
                // For Groq, prefer base64 format for images
                return {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                  }
                };
              }
            }
          }
          return item;
        })
      };
    }
    return message;
  });
}
