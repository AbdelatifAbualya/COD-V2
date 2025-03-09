// Netlify Function to securely proxy requests to Groq API
exports.handler = async function(event, context) {
  // Set the function timeout to 120 seconds (2 minutes)
  context.callbackWaitsForEmptyEventLoop = false;
  
  // Load fetch at runtime
  const fetch = require('node-fetch');
  
  // Configure fetch timeout to 120 seconds (Netlify's maximum)
  const fetchWithTimeout = async (url, options, timeout = 120000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("Request is taking too long, aborting...");
      controller.abort();
    }, timeout);
    
    try {
      options.signal = controller.signal;
      const response = await fetch(url, options);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  
  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Allow': 'POST'
      }
    };
  }

  try {
    // Get API key from environment variable
    const API_KEY = process.env.GROQ_API_KEY;
    
    if (!API_KEY) {
      console.log("ERROR: API key is missing");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured on server' }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Log request info (non-sensitive)
    console.log("Received request");
    
    try {
      // Parse the request body
      const requestBody = JSON.parse(event.body);
      
      // Check for required model parameter
      if (!requestBody.model) {
        console.error("Missing required 'model' parameter");
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing required parameter: model' }),
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        };
      }
      
      // Log model info
      const modelName = requestBody.model;
      console.log(`Model requested: ${modelName}`);
      
      // Add timing metrics for monitoring CoD vs CoT performance
      let reasoningMethod = 'Standard';
      if (requestBody.messages && requestBody.messages.length > 0 && requestBody.messages[0].role === 'system') {
        const systemPrompt = requestBody.messages[0].content;
        if (systemPrompt.includes('Chain of Draft')) {
          reasoningMethod = 'CoD';
        } else if (systemPrompt.includes('Chain of Thought')) {
          reasoningMethod = 'CoT';
        }
      }
      
      console.log(`Using reasoning method: ${reasoningMethod}`);
      console.log(`Messages count: ${requestBody.messages ? requestBody.messages.length : 0}`);
      
      // Ensure messages is an array and has at least one message
      if (!Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
        console.error("Invalid or empty 'messages' array");
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid or empty messages array' }),
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        };
      }
      
      // Start timer
      const startTime = Date.now();
      
      // Prepare request for Groq API - only include supported parameters
      const groqRequest = {
        model: modelName,
        messages: requestBody.messages,
      };
      
      // Add optional parameters only if they exist and are valid
      if (typeof requestBody.temperature === 'number') {
        groqRequest.temperature = requestBody.temperature;
      }
      
      if (typeof requestBody.top_p === 'number') {
        groqRequest.top_p = requestBody.top_p;
      }
      
      // Note: Groq API may not support top_k directly, check their API docs
      // Some models may use it with a different name or not at all
      if (typeof requestBody.max_tokens === 'number') {
        groqRequest.max_tokens = requestBody.max_tokens;
      } else {
        groqRequest.max_tokens = 1024; // Default if not specified
      }
      
      if (typeof requestBody.frequency_penalty === 'number') {
        groqRequest.frequency_penalty = requestBody.frequency_penalty;
      }
      
      if (typeof requestBody.presence_penalty === 'number') {
        groqRequest.presence_penalty = requestBody.presence_penalty;
      }
      
      // Log request body for debugging (exclude messages to keep logs clean)
      const logRequest = { ...groqRequest };
      delete logRequest.messages;
      console.log(`Sending request to Groq API: ${JSON.stringify(logRequest)}`);
      
      // Forward the request to Groq API
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(groqRequest)
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      console.log(`Groq API response status: ${response.status}, time: ${responseTime}ms`);
      
      // Check if response is ok
      if (!response.ok) {
        // Get error details
        let errorText = "";
        let errorJson = null;
        
        try {
          errorText = await response.text();
          // Try to parse as JSON for better error details
          try {
            errorJson = JSON.parse(errorText);
            console.error(`API error (${response.status}): ${JSON.stringify(errorJson)}`);
          } catch (jsonParseError) {
            console.error(`API error (${response.status}): ${errorText}`);
          }
        } catch (e) {
          errorText = "Could not read error response";
          console.error(`API error (${response.status}): Unable to read error details`);
        }
        
        return {
          statusCode: response.status,
          body: JSON.stringify({ 
            error: `API Error: ${response.statusText}`, 
            details: errorJson || errorText
          }),
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        };
      }
      
      // Get the response data
      const data = await response.json();
      
      // Add performance metrics to response
      if (data && !data.error) {
        data.performance = {
          response_time_ms: responseTime,
          reasoning_method: reasoningMethod
        };
      }
      
      console.log("Successfully received response from Groq API");
      
      // Return the response from Groq
      return {
        statusCode: 200,
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      };
    } catch (parseError) {
      // Check if this is an abort error (timeout)
      if (parseError.name === 'AbortError') {
        console.error("Request timed out after 120 seconds");
        return {
          statusCode: 504,
          body: JSON.stringify({ 
            error: 'Gateway Timeout', 
            message: 'The request to the LLM API took too long to complete (>120 seconds). Try reducing complexity or using fewer tokens.'
          }),
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        };
      }
      
      console.error("Error processing request:", parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Bad Request', 
          message: 'Error processing request: ' + parseError.message
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }
  } catch (error) {
    console.error('Function error:', error.message, error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal Server Error', 
        message: error.message
      }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }
};
