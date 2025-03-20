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
    const modelName = requestBody.model;
    console.log('Request received for model:', modelName);
    
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
    
    // We'll use the Groq API endpoint
    const apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    console.log(`Using Groq API endpoint: ${apiEndpoint}`);
    
    // Implement retry logic
    let retries = 3;
    let response;
    
    while (retries > 0) {
      try {
        // Set up abort controller for timeout - increased from 60000 to 180000 (3 minutes)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3-minute timeout
        
        // Log request size for debugging
        const requestSize = JSON.stringify(requestBody).length;
        console.log(`Request size: ${requestSize} bytes`);
        
        // Log the request structure (without full image data)
        const debugRequestBody = JSON.parse(JSON.stringify(requestBody));
        if (debugRequestBody.messages) {
          debugRequestBody.messages = debugRequestBody.messages.map(msg => {
            if (Array.isArray(msg.content)) {
              return {
                ...msg,
                content: msg.content.map(item => {
                  if (item.type === 'image_url') {
                    return {
                      type: 'image_url',
                      image_url: { 
                        url: item.image_url.url.substring(0, 50) + '... [truncated]' 
                      }
                    };
                  }
                  return item;
                })
              };
            }
            return msg;
          });
        }
        console.log('Processed request structure:', JSON.stringify(debugRequestBody, null, 2));
        
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
      
      // Special handling for 400 errors related to images
      if (response.status === 400 && isVisionModel) {
        errorMessage = `${errorMessage}\n\nThis may be because:\n1. The selected model doesn't support the image format\n2. The image is too large\n3. The model doesn't fully support multimodal inputs`;
      }
      
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: `Groq API error: ${response.status}`,
          message: errorMessage,
          details: {
            possible_fixes: [
              "Verify the API key is correct in Netlify",
              "Check that the model name is valid for Groq API",
              "Ensure your Groq API subscription is active",
              "Try a different image format or size",
              "Verify the model supports vision features"
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
