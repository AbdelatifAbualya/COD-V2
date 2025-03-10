// netlify/functions/api-proxy.js
const fetch = require('node-fetch');
const { AbortController } = require('abort-controller');
const { Buffer } = require('buffer');

/**
 * Netlify serverless function to proxy requests to Qroq API
 */
exports.handler = async function(event, context) {
  // Set up CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  
  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }
  
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Check if API key is set - explicitly check for QROQ_API_KEY first since that's what the user set
    const apiKey = process.env.QROQ_API_KEY || process.env.GROQ_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      console.error('No API key found in environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'API key not configured',
          message: 'Please set QROQ_API_KEY in your Netlify environment variables'
        })
      };
    }

    // Parse the request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    // Log request info
    console.log('Request received for model:', requestBody.model);

    // Validate required parameters
    const { model, messages } = requestBody;
    if (!model) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required parameter: model' })
      };
    }
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing or invalid messages array' })
      };
    }

    // We'll use the Qroq API endpoint
    const apiEndpoint = 'https://api.qroq.com/v1/chat/completions';
    console.log(`Using Qroq API endpoint: ${apiEndpoint}`);

    // Generate a request ID for tracking
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    console.log(`[${requestId}] Processing request for model: ${model}`);

    // Set up retry logic
    const MAX_RETRIES = 3;
    let retries = MAX_RETRIES;
    let response = null;

    // Configure timeout
    const controller = new AbortController();
    const timeoutDuration = 110000; // 110 seconds (just under Netlify's 120s limit)
    const timeout = setTimeout(() => {
      console.log(`[${requestId}] Request timeout after ${timeoutDuration}ms`);
      controller.abort();
    }, timeoutDuration);

    // Retry loop
    while (retries > 0) {
      try {
        // Make a request to the Qroq API
        console.log(`Sending request to Qroq API (attempts remaining: ${retries})`);
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        
        // If we get a response, break out of the retry loop
        break;
      } catch (error) {
        retries--;
        if (retries === 0 || error.name === 'AbortError') {
          // Rethrow if we're out of retries or if it's a timeout
          throw error;
        }
        
        console.log(`[${requestId}] Request failed, retrying (${retries} attempts left): ${error.message}`);
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, (MAX_RETRIES - retries) * 1000));
      }
    }

    // Clear the timeout since request completed
    clearTimeout(timeout);
    
    // Check if we have a response
    if (!response) {
      throw new Error('Failed to get response from Qroq API after multiple attempts');
    }

    // Parse the response
    const responseData = await response.json();
    
    // Check for API errors
    if (!response.ok) {
      console.error(`[${requestId}] Qroq API error:`, responseData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'Qroq API Error',
          details: responseData.error || responseData
        })
      };
    }
    
    // Return the successful response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData)
    };
  } catch (error) {
    console.error(`Error processing request:`, error);
    
    let errorMessage = 'Error processing request';
    let statusCode = 500;
    
    if (error.name === 'AbortError') {
      errorMessage = `Request timed out after ${timeoutDuration / 1000} seconds`;
      statusCode = 504;
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'Could not connect to Qroq API';
      statusCode = 502;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Connection to Qroq API timed out';
      statusCode = 504;
    }
    
    return {
      statusCode,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        details: error.message
      })
    };
  }
};
