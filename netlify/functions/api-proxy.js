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
      
      // Log model info
      const modelName = requestBody.model || 'not specified';
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
      
      // Start timer
      const startTime = Date.now();
      
      // Prepare request for Groq API
      const groqRequest = {
        model: requestBody.model,
        messages: requestBody.messages,
        temperature: requestBody.temperature,
        top_p: requestBody.top_p,
        top_k: requestBody.top_k, // Added support for top_k
        max_tokens: requestBody.max_tokens || 1024, // Ensure max_tokens is set
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty
      };
      
      // Log request body for debugging
      console.log(`Sending request to Groq API: ${JSON.stringify({
        model: groqRequest.model,
        temperature: groqRequest.temperature,
        top_p: groqRequest.top_p,
        top_k: groqRequest.top_k,
        max_tokens: groqRequest.max_tokens
      })}`);
      
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
        try {
          errorText = await response.text();
          console.error(`API error (${response.status}): ${errorText}`);
        } catch (e) {
          errorText = "Could not read error response";
          console.error(`API error (${response.status}): Unable to read error details`);
        }
        
        return {
          statusCode: response.status,
          body: JSON.stringify({ 
            error: `API Error: ${response.statusText}`, 
            details: errorText
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
