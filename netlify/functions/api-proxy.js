// netlify/functions/api-proxy.js
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

exports.handler = async function(event, context) {
  // Set CORS headers to allow requests from any origin
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  // Ensure this is a POST request
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get the API key from environment variables
    const apiKey = process.env.QROQ_API_KEY;
    
    if (!apiKey) {
      console.error('API key not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API key not configured on server' })
      };
    }

    // Parse the incoming request body
    const requestBody = JSON.parse(event.body);
    
    // Get the model from the request
    const modelName = requestBody.model;
    
    if (!modelName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Model name is required' })
      };
    }

    // Configure the API endpoint
    const API_URL = 'https://api.qroq.com/v1/chat/completions';
    
    console.log(`Proxying request to ${modelName}`);

    // Set a timeout for the fetch request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110000); // 110 second timeout (just under the 120s Lambda limit)

    try {
      // Prepare the API request
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Check if the response is OK
      if (!response.ok) {
        const errorData = await response.text();
        console.error(`API Error (${response.status}):`, errorData);
        
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ 
            error: `API Error: ${response.statusText}`,
            details: errorData
          })
        };
      }

      // Get the API response
      const data = await response.json();

      // Return the API response
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    } catch (fetchError) {
      clearTimeout(timeout);
      
      if (fetchError.name === 'AbortError') {
        console.error('Request timed out');
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({ error: 'Request timed out' })
        };
      }
      
      throw fetchError;
    }
  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Server error: ${error.message}` })
    };
  }
};
