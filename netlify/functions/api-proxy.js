// Add at the top of your script with other global variables
let SELF_CONSISTENCY_ENABLED = false;
let SELF_CONSISTENCY_PATHS = 3;  // Default number of reasoning paths to generate

// Add this function to your init function
function initSelfConsistency() {
  // Try to load saved settings
  const savedEnabled = localStorage.getItem("selfConsistencyEnabled");
  if (savedEnabled !== null) {
    SELF_CONSISTENCY_ENABLED = savedEnabled === "true";
  }
  
  const savedPaths = localStorage.getItem("selfConsistencyPaths");
  if (savedPaths) {
    SELF_CONSISTENCY_PATHS = parseInt(savedPaths);
  }
  
  // Setup UI elements
  const toggle = document.getElementById('selfConsistencyToggle');
  const options = document.getElementById('selfConsistencyOptions');
  const pathSlider = document.getElementById('pathCount');
  const pathValue = document.getElementById('pathCountValue');
  
  if (toggle) {
    toggle.checked = SELF_CONSISTENCY_ENABLED;
    if (options) {
      options.style.display = SELF_CONSISTENCY_ENABLED ? 'block' : 'none';
    }
    
    toggle.addEventListener('change', () => {
      SELF_CONSISTENCY_ENABLED = toggle.checked;
      if (options) {
        options.style.display = SELF_CONSISTENCY_ENABLED ? 'block' : 'none';
      }
      updateCurrentModelDisplay();
    });
  }
  
  if (pathSlider && pathValue) {
    pathSlider.value = SELF_CONSISTENCY_PATHS;
    pathValue.textContent = SELF_CONSISTENCY_PATHS;
    
    pathSlider.addEventListener('input', () => {
      SELF_CONSISTENCY_PATHS = parseInt(pathSlider.value);
      pathValue.textContent = SELF_CONSISTENCY_PATHS;
    });
  }
}

// Add this to your saveSettings function
function saveSelfConsistencySettings() {
  localStorage.setItem("selfConsistencyEnabled", SELF_CONSISTENCY_ENABLED.toString());
  localStorage.setItem("selfConsistencyPaths", SELF_CONSISTENCY_PATHS.toString());
}

// Update your updateCurrentModelDisplay function
function updateCurrentModelDisplay() {
  const element = document.getElementById("currentModelDisplay");
  if (element) {
    let displayText = getModelDisplayName(MODEL_NAME);
    
    // Add badge for reasoning method
    let reasoningBadge = "";
    switch (REASONING_METHOD) {
      case "cot":
        reasoningBadge = '<span class="reasoning-badge" style="background-color: #2c6b9c;">CoT</span>';
        break;
      case "cod":
        reasoningBadge = `<span class="reasoning-badge" style="background-color: #2c6b9c;">CoD-${COD_WORD_LIMIT}</span>`;
        break;
    }
    
    // Add enhanced reasoning badge if enabled
    if (ENHANCED_REASONING_ENABLED && REASONING_ENHANCEMENT === "adaptive") {
      reasoningBadge += '<span class="reasoning-badge" style="background-color: #2d5038; margin-left: 3px;">Adaptive</span>';
    }
    
    // Add self-consistency badge if enabled
    if (SELF_CONSISTENCY_ENABLED && REASONING_METHOD === "cod") {
      reasoningBadge += '<span class="reasoning-badge" style="background-color: #5c3d7a; margin-left: 3px;">SC-' + SELF_CONSISTENCY_PATHS + '</span>';
    }
    
    element.innerHTML = displayText + reasoningBadge;
  }
}

// Helper function to normalize answers for better matching
function normalizeAnswer(answer) {
  // Remove common prefixes
  let normalized = answer.replace(/^(the answer is|therefore|thus|so|hence|the result is|we get|we find that|the final answer is|the value is|the solution is):\s*/i, "");
  
  // Remove units for better matching (but preserve them for display)
  const unitRegex = /\b(dollars|inches|feet|meters|pounds|kg|miles|km|years|days|hours|minutes|seconds|percent|degrees|watts|volts|amps|\$|%|°C|°F)\b/gi;
  
  // Store the units to preserve the full answer
  const units = answer.match(unitRegex) || [];
  
  // Temporarily remove units for comparison
  normalized = normalized.replace(unitRegex, "");
  
  // Remove common formatting and punctuation, keeping only core answer
  normalized = normalized.replace(/[.,;:!\s]+/g, " ").trim();
  
  // Convert to lowercase for case-insensitive comparison
  normalized = normalized.toLowerCase();
  
  return normalized;
}

// Modified sendMessage function to support self-consistency
async function sendMessage(message) {
  // NEW: Analyze problem complexity if enhanced reasoning is enabled
  if (ENHANCED_REASONING_ENABLED && REASONING_ENHANCEMENT === "adaptive") {
    analyzeProblemComplexity(message);
  }
  
  // Check if there are files to be included
  const filesToSend = [...attachedFiles]; // Make a copy of the current files
  
  // Add message to thread with files
  addMessageToCurrentThread(message, "user", false, filesToSend);
  
  // Clear attached files after sending
  attachedFiles = [];
  const attachedFilesContainer = document.getElementById('attachedFiles');
  if (attachedFilesContainer) {
    attachedFilesContainer.innerHTML = '';
    attachedFilesContainer.style.display = 'none';
  }
  
  if (!MODEL_NAME) {
    const errorMsg = "Error: Please set the Model Name in the Settings.";
    addMessageToCurrentThread(errorMsg, "bot");
    console.error(errorMsg);
    return;
  }

  // Parse message for word count requirements
  const wordCountRequest = parseWordCountRequest(message);
  
  // If self-consistency is enabled and we're using CoD, use multiple paths
  if (SELF_CONSISTENCY_ENABLED && REASONING_METHOD === "cod") {
    addMessageToCurrentThread(`Generating ${SELF_CONSISTENCY_PATHS} reasoning paths to increase accuracy...`, "bot", true);
    const thread = threads.find(t => t.id === currentThreadId);
    const placeholderIndex = thread.messages.length - 1;
    
    // Build messages array with current settings and word count request
    const messagesForApi = buildMessagesForChat(wordCountRequest);
    
    // Base payload 
    const basePayload = {
      model: MODEL_NAME,
      max_tokens: MAX_TOKENS,
      top_p: TOP_P,
      top_k: TOP_K,
      presence_penalty: PRESENCE_PENALTY,
      frequency_penalty: FREQUENCY_PENALTY,
      temperature: TEMPERATURE + 0.2, // Increase temperature slightly for diversity
      messages: messagesForApi
    };
    
    try {
      // Generate multiple reasoning paths
      const responses = [];
      const answers = {};
      
      // Display progress in placeholder
      thread.messages[placeholderIndex] = {
        content: `Generating ${SELF_CONSISTENCY_PATHS} reasoning paths (0/${SELF_CONSISTENCY_PATHS} complete)...`,
        sender: "bot",
        isPlaceholder: true,
        timestamp: new Date()
      };
      renderCurrentThreadMessages();
      
      for (let i = 0; i < SELF_CONSISTENCY_PATHS; i++) {
        // Add timestamp to URL to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `?t=${timestamp}&path=${i}`;
        
        // Update payload with slightly different temperature for diversity
        const pathPayload = {
          ...basePayload,
          temperature: basePayload.temperature + (i * 0.05) // Gradually increase temperature
        };
        
        try {
          // Update progress
          thread.messages[placeholderIndex] = {
            content: `Generating ${SELF_CONSISTENCY_PATHS} reasoning paths (${i}/${SELF_CONSISTENCY_PATHS} complete)...`,
            sender: "bot",
            isPlaceholder: true,
            timestamp: new Date()
          };
          renderCurrentThreadMessages();
          
          const response = await fetch(`${API_PROXY_URL}${cacheBuster}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(pathPayload)
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          
          const data = await response.json();
          const botReply = data.choices &&
                         data.choices[0] &&
                         data.choices[0].message &&
                         data.choices[0].message.content;
                         
          if (botReply) {
            const trimmedReply = botReply.trim();
            responses.push(trimmedReply);
            
            // Process to extract answer
            const processed = processBotMessage(trimmedReply, REASONING_METHOD);
            const finalAnswer = processed.answer ? processed.answer.trim() : "";
            
            // Count this answer (simple voting)
            if (finalAnswer) {
              // Normalize the answer a bit (remove common variants)
              const normalizedAnswer = normalizeAnswer(finalAnswer);
              answers[normalizedAnswer] = (answers[normalizedAnswer] || 0) + 1;
            }
          }
        } catch (error) {
          console.error(`Error in path ${i + 1}:`, error);
          // Continue with other paths even if one fails
        }
      }
      
      // Find the most common answer
      let mostCommonAnswer = "";
      let highestCount = 0;
      
      for (const [answer, count] of Object.entries(answers)) {
        if (count > highestCount) {
          mostCommonAnswer = answer;
          highestCount = count;
        }
      }
      
      // Calculate agreement percentage
      const agreementPercentage = (highestCount / SELF_CONSISTENCY_PATHS) * 100;
      
      // Find a response that contains the most common answer
      let bestResponse = "";
      for (const response of responses) {
        if (response.includes(mostCommonAnswer)) {
          bestResponse = response;
          break;
        }
      }
      
      // If no best response found (unlikely), use the first one
      if (!bestResponse && responses.length > 0) {
        bestResponse = responses[0];
      }
      
      if (bestResponse) {
        // Create response metadata
        let reasoningInfo = `${REASONING_METHOD.toUpperCase()}-${COD_WORD_LIMIT}`;
        reasoningInfo += `-SC-${SELF_CONSISTENCY_PATHS}`;
        
        // Add enhanced reasoning info if used
        if (ENHANCED_REASONING_ENABLED && 
            REASONING_ENHANCEMENT === "adaptive" && 
            PROBLEM_COMPLEXITY.complexity === "complex") {
          reasoningInfo += "-ENHANCED";
        }
        
        // Process bot message to separate thinking and answer parts
        const processed = processBotMessage(bestResponse, REASONING_METHOD);
        
        // Build an explanation of the self-consistency results
        const selfConsistencyInfo = `
\n\n---
**Self-Consistency Summary:**
- Generated ${SELF_CONSISTENCY_PATHS} independent reasoning paths
- ${highestCount} paths agreed on this answer (${Math.round(agreementPercentage)}% agreement)`;
        
        // Append the self-consistency info to the answer
        if (processed.answer) {
          processed.answer += selfConsistencyInfo;
        } else {
          processed.answer = bestResponse + selfConsistencyInfo;
        }
        
        thread.messages[placeholderIndex] = {
          content: bestResponse + selfConsistencyInfo,
          sender: "bot",
          isPlaceholder: false,
          timestamp: new Date(),
          wordCount: (processed.thinkingWordCount || 0) + (processed.answerWordCount || 0),
          reasoningMethod: reasoningInfo,
          thinking: processed.thinking,
          answer: processed.answer,
          thinkingWordCount: processed.thinkingWordCount || 0,
          answerWordCount: processed.answerWordCount || 0,
          selfConsistencyResults: {
            paths: SELF_CONSISTENCY_PATHS,
            agreement: agreementPercentage,
            agreementCount: highestCount,
            allResponses: responses
          }
        };
      } else {
        thread.messages[placeholderIndex] = {
          content: "No valid responses received. Check model name and API key.",
          sender: "bot",
          isPlaceholder: false,
          timestamp: new Date(),
          wordCount: 0,
          reasoningMethod: REASONING_METHOD.toUpperCase(),
          thinking: null,
          answer: null,
          thinkingWordCount: 0,
          answerWordCount: 0
        };
      }
    } catch (error) {
      console.error("Error in self-consistency:", error);
      
      thread.messages[placeholderIndex] = {
        content: "Error generating multiple reasoning paths: " + error.message,
        sender: "bot",
        isPlaceholder: false,
        timestamp: new Date(),
        wordCount: 0,
        reasoningMethod: REASONING_METHOD.toUpperCase(),
        thinking: null,
        answer: null,
        thinkingWordCount: 0,
        answerWordCount: 0
      };
    }
    
    renderCurrentThreadMessages();
  } else {
    // Standard message sending (existing code)
    addMessageToCurrentThread("Bot is typing...", "bot", true);
    const thread = threads.find(t => t.id === currentThreadId);
    const placeholderIndex = thread.messages.length - 1;

    // Build messages array with current settings and word count request
    const messagesForApi = buildMessagesForChat(wordCountRequest);

    // Create payload
    const payload = {
      model: MODEL_NAME,
      max_tokens: MAX_TOKENS,
      top_p: TOP_P,
      top_k: TOP_K,
      presence_penalty: PRESENCE_PENALTY,
      frequency_penalty: FREQUENCY_PENALTY,
      temperature: TEMPERATURE,
      messages: messagesForApi
    };
    
    console.log(`Sending request with ${REASONING_METHOD} reasoning ${REASONING_METHOD === "cod" ? `(word limit: ${COD_WORD_LIMIT})` : ""}`);
    if (wordCountRequest) {
      console.log(`Final answer word limit requested: ${wordCountRequest} words`);
    }
    console.log(`Parameters: temp=${TEMPERATURE}, top_p=${TOP_P}, top_k=${TOP_K}`);

    try {
      // Add timestamp to URL to prevent caching
      const timestamp = new Date().getTime();
      const cacheBuster = `?t=${timestamp}`;
      
      const response = await fetch(`${API_PROXY_URL}${cacheBuster}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      const botReply = data.choices &&
                       data.choices[0] &&
                       data.choices[0].message &&
                       data.choices[0].message.content;
      if (botReply) {
        const trimmedReply = botReply.trim();
        
        // Create response metadata
        let reasoningInfo = REASONING_METHOD.toUpperCase();
        if (REASONING_METHOD === "cod") {
          reasoningInfo += `-${COD_WORD_LIMIT}`;
        }
        
        // Add enhanced reasoning info if used
        if (ENHANCED_REASONING_ENABLED && 
            REASONING_ENHANCEMENT === "adaptive" && 
            PROBLEM_COMPLEXITY.complexity === "complex") {
          reasoningInfo += "-ENHANCED";
        }
        
        // Process bot message to separate thinking and answer parts
        const processed = processBotMessage(trimmedReply, REASONING_METHOD);
        
        thread.messages[placeholderIndex] = {
          content: trimmedReply,
          sender: "bot",
          isPlaceholder: false,
          timestamp: new Date(),
          wordCount: (processed.thinkingWordCount || 0) + (processed.answerWordCount || 0),
          reasoningMethod: reasoningInfo,
          thinking: processed.thinking,
          answer: processed.answer,
          thinkingWordCount: processed.thinkingWordCount || 0,
          answerWordCount: processed.answerWordCount || 0
        };
      } else {
        thread.messages[placeholderIndex] = {
          content: "No valid response received. Check model name and API key.",
          sender: "bot",
          isPlaceholder: false,
          timestamp: new Date(),
          wordCount: 0,
          reasoningMethod: REASONING_METHOD.toUpperCase(),
          thinking: null,
          answer: null,
          thinkingWordCount: 0,
          answerWordCount: 0
        };
      }
    } catch (error) {
      console.error("Error communicating with API:", error);
      
      // Provide more detailed error message
      let errorMessage = "Error communicating with API: " + error.message;
      
      // Add suggestions based on error type
      if (error.message.includes("Failed to fetch")) {
        errorMessage += "\n\nPossible solutions:\n1. Make sure your API key is set correctly in Netlify\n2. Check that your model name is valid\n3. Verify your internet connection";
      }
      
      thread.messages[placeholderIndex] = {
        content: errorMessage,
        sender: "bot",
        isPlaceholder: false,
        timestamp: new Date(),
        wordCount: 0,
        reasoningMethod: REASONING_METHOD.toUpperCase(),
        thinking: null,
        answer: null,
        thinkingWordCount: 0,
        answerWordCount: 0
      };
    }
    renderCurrentThreadMessages();
  }
}

// Update your saveSettings function (add to existing function)
function saveSettings() {
  try {
    // Your existing saveSettings code...
    
    // Save self-consistency settings
    saveSelfConsistencySettings();
    
    // Rest of your saveSettings code...
  } catch (err) {
    console.error("Error in saveSettings:", err);
    showNotification("Error saving settings");
  }
}

// Add this to your init function
function init() {
  console.log("Initializing app...");
  
  try {
    loadPersistedSettings();
    console.log("Settings loaded");
    
    // Update CoD prompt with the correct word limit
    updateCoDPrompt();
    console.log("CoD prompt updated");
    
    createNewThread();
    console.log("New thread created");
    
    // NEW: Initialize self-consistency
    initSelfConsistency();
    console.log("Self-consistency initialized");
    
    initEventListeners();
    console.log("Event listeners initialized");
    
    updateCurrentModelDisplay();
    console.log("Model display updated");
    
    // Rest of your init function...
  } catch (err) {
    console.error("Initialization error:", err);
  }
}
