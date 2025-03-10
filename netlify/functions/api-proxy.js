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
    // Check if API key is set
    if (!process.env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY environment variable is not set');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured' }),
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      };
    }

    // Parse the request body
    const requestBody = JSON.parse(event.body);
    console.log('Request received for model:', requestBody.model);
    
    // Implement retry logic for Groq API
    let retries = 3;
    let response;
    
    while (retries > 0) {
      try {
        // Set up abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout
        
        // Make a request to the Groq API
        console.log(`Sending request to Groq API (attempts remaining: ${retries})`);
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
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
      
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: `Groq API error: ${response.status}`,
          message: errorMessage 
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
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message || 'Unknown error occurred',
        details: {
          name: error.name,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      }),
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    };
  }
};
