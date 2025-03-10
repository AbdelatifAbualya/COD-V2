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
    // Check if API key is set - explicitly check for QROQ_API_KEY first since that's what the user set
    const apiKey = process.env.QROQ_API_KEY || process.env.GROQ_API_KEY || process.env.API_KEY;
    
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
    
    // We'll use the Qroq API endpoint
    const apiEndpoint = 'https://api.qroq.com/v1/chat/completions';
    console.log(`Using Qroq API endpoint: ${apiEndpoint}`);
    
    // Implement retry logic
    let retries = 3;
    let response;
    
    while (retries > 0) {
      try {
        // Set up abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout
        
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
        
        // Clear timeout
        clearTimeout(timeoutId);
        
        // If we get a 502, retry; otherwise, break the loop
        if (response.status === 502) {
          console.log('Received 502 from Qroq API, retrying...');
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
      throw new Error('Failed to get response from Qroq API after multiple attempts');
    }

    // Handle response errors
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Qroq API error: ${response.status}`, errorData);
      
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
          error: `Qroq API error: ${response.status}`,
          message: errorMessage,
          details: {
            possible_fixes: [
              "Verify the API key is correct in Netlify",
              "Check that the model name is valid for Qroq API",
              "Ensure your Qroq API subscription is active"
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
    console.log('Received successful response from Qroq API');

    // Return the response
    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
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
            "Check if the model name is valid for Qroq API",
            "Ensure network connection is stable",
            "Verify your Qroq API subscription is active"
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
