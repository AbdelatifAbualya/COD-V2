// Add these variables at the top of your script, after other global variables
let attachedFiles = [];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB max file size
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_FILE_TYPES = [...SUPPORTED_IMAGE_TYPES, 'application/pdf', 'text/plain', 'text/csv', 'application/json'];

/***********************
 * File Upload Handling
 ***********************/
function initFileUpload() {
  const fileInput = document.getElementById('fileInput');
  const fileUploadBtn = document.getElementById('fileUploadBtn');
  const attachedFilesContainer = document.getElementById('attachedFiles');
  
  if (fileUploadBtn) {
    fileUploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      
      // Process each file
      for (const file of files) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          showNotification(`File too large: ${file.name} (max 20MB)`, 5000);
          continue;
        }
        
        // Check file type
        if (!SUPPORTED_FILE_TYPES.includes(file.type)) {
          showNotification(`Unsupported file type: ${file.type}`, 5000);
          continue;
        }
        
        // Add file to attachedFiles array
        attachedFiles.push(file);
      }
      
      // Reset file input
      fileInput.value = '';
      
      // Update the attached files display
      updateAttachedFilesDisplay();
    });
  }
}

function updateAttachedFilesDisplay() {
  const attachedFilesContainer = document.getElementById('attachedFiles');
  if (!attachedFilesContainer) return;
  
  // Clear the container
  attachedFilesContainer.innerHTML = '';
  
  // If no files, hide the container
  if (attachedFiles.length === 0) {
    attachedFilesContainer.style.display = 'none';
    return;
  }
  
  // Show the container
  attachedFilesContainer.style.display = 'flex';
  
  // Add previews for each file
  attachedFiles.forEach((file, index) => {
    const filePreview = document.createElement('div');
    filePreview.className = 'file-preview';
    
    // Create preview based on file type
    if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      // Create image preview
      const img = document.createElement('img');
      img.className = 'file-preview-image';
      img.src = URL.createObjectURL(file);
      filePreview.appendChild(img);
    } else {
      // Create icon preview
      const icon = document.createElement('div');
      icon.className = 'file-preview-icon';
      
      let iconText = '📄';
      if (file.type === 'application/pdf') iconText = '📝';
      else if (file.type === 'text/csv') iconText = '📊';
      else if (file.type === 'application/json') iconText = '{ }';
      
      icon.textContent = iconText;
      filePreview.appendChild(icon);
    }
    
    // Add file name
    const fileName = document.createElement('div');
    fileName.className = 'file-preview-name';
    fileName.title = file.name;
    fileName.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
    filePreview.appendChild(fileName);
    
    // Add remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-preview-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      attachedFiles.splice(index, 1);
      updateAttachedFilesDisplay();
    });
    filePreview.appendChild(removeBtn);
    
    attachedFilesContainer.appendChild(filePreview);
  });
}

/***********************
 * File Processing for API
 ***********************/
async function processFilesForAPI() {
  if (attachedFiles.length === 0) return [];
  
  const processedFiles = [];
  
  for (const file of attachedFiles) {
    try {
      // Read file as base64
      const base64Data = await readFileAsBase64(file);
      
      // Determine file role based on type
      const fileRole = SUPPORTED_IMAGE_TYPES.includes(file.type) ? 'image' : 'file';
      
      // Create file object for API
      processedFiles.push({
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        file_data: base64Data,
        file_role: fileRole
      });
    } catch (error) {
      console.error(`Error processing file: ${file.name}`, error);
      showNotification(`Error processing file: ${file.name}`, 5000);
    }
  }
  
  return processedFiles;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Get the base64 string without the prefix (e.g., "data:image/jpeg;base64,")
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

/***********************
 * Render File Attachments
 ***********************/
function renderFileAttachments(containerEl, files) {
  if (!files || files.length === 0) return;
  
  files.forEach(file => {
    // Create attachment wrapper
    if (file.file_role === 'image') {
      // Render image
      const imgContainer = document.createElement('div');
      
      const img = document.createElement('img');
      img.className = 'message-image';
      img.src = `data:${file.file_type};base64,${file.file_data}`;
      img.alt = file.file_name;
      img.addEventListener('click', () => {
        // Open image in new tab
        const newTab = window.open();
        newTab.document.write(`<img src="data:${file.file_type};base64,${file.file_data}" style="max-width: 100%; height: auto;">`);
      });
      
      imgContainer.appendChild(img);
      containerEl.appendChild(imgContainer);
    } else {
      // Render file attachment
      const attachmentDiv = document.createElement('div');
      attachmentDiv.className = 'message-file-attachment';
      
      // Icon based on file type
      const iconEl = document.createElement('div');
      iconEl.className = 'message-file-icon';
      let iconText = '📄';
      if (file.file_type === 'application/pdf') iconText = '📝';
      else if (file.file_type === 'text/csv') iconText = '📊';
      else if (file.file_type === 'application/json') iconText = '{ }';
      iconEl.textContent = iconText;
      
      // File info
      const infoEl = document.createElement('div');
      infoEl.className = 'message-file-info';
      
      const nameEl = document.createElement('div');
      nameEl.className = 'message-file-name';
      nameEl.textContent = file.file_name;
      
      const sizeEl = document.createElement('div');
      sizeEl.className = 'message-file-size';
      sizeEl.textContent = formatFileSize(file.file_size);
      
      infoEl.appendChild(nameEl);
      infoEl.appendChild(sizeEl);
      
      attachmentDiv.appendChild(iconEl);
      attachmentDiv.appendChild(infoEl);
      containerEl.appendChild(attachmentDiv);
    }
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Update the addMessageToCurrentThread function to support files
function addMessageToCurrentThread(content, sender, isPlaceholder = false, files = []) {
  const thread = threads.find(t => t.id === currentThreadId);
  if (thread) {
    // Process bot messages to separate thinking from answer
    let thinking = null;
    let answer = null;
    let thinkingWordCount = 0;
    let answerWordCount = 0;
    let totalWordCount = 0;
    
    if (sender === "bot" && !isPlaceholder) {
      const processed = processBotMessage(content, REASONING_METHOD);
      thinking = processed.thinking;
      answer = processed.answer;
      thinkingWordCount = processed.thinkingWordCount || 0;
      answerWordCount = processed.answerWordCount || 0;
      totalWordCount = thinkingWordCount + answerWordCount;
    }
    
    thread.messages.push({
      content,
      sender,
      isPlaceholder,
      timestamp: new Date(),
      wordCount: sender === "bot" && !isPlaceholder ? totalWordCount : undefined,
      reasoningMethod: sender === "bot" && !isPlaceholder ? 
        (REASONING_METHOD === "cod" ? `${REASONING_METHOD.toUpperCase()}-${COD_WORD_LIMIT}` : REASONING_METHOD.toUpperCase()) : 
        undefined,
      thinking,
      answer,
      thinkingWordCount: sender === "bot" && !isPlaceholder ? thinkingWordCount : undefined,
      answerWordCount: sender === "bot" && !isPlaceholder ? answerWordCount : undefined,
      // NEW: Add complexity info for debugging
      complexityInfo: sender === "user" ? PROBLEM_COMPLEXITY : undefined,
      // NEW: Add files array
      files: files && files.length > 0 ? files : undefined
    });
    renderCurrentThreadMessages();
  }
}

// Update renderCurrentThreadMessages to display files in messages
function renderCurrentThreadMessages() {
  const chatMessagesDiv = document.getElementById("chatMessages");
  chatMessagesDiv.innerHTML = "";
  const thread = threads.find(t => t.id === currentThreadId);
  if (thread) {
    thread.messages.forEach(msg => {
      const messageDiv = document.createElement("div");
      messageDiv.classList.add("message", msg.sender);
      if (msg.isPlaceholder) {
        messageDiv.classList.add("placeholder");
      }

      const timestampStr = msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const timestampEl = document.createElement("small");
      timestampEl.textContent = timestampStr;
      timestampEl.style.color = "#aaa";
      timestampEl.style.display = "block";
      timestampEl.style.marginBottom = "0.5rem";
      messageDiv.appendChild(timestampEl);

      // Special handling for messages with thinking/answer components
      if (msg.sender === "bot" && !msg.isPlaceholder) {
        const messageContainer = document.createElement("div");
        messageContainer.className = "message-container";
        
        // If we have thinking steps (for CoT or CoD)
        if (msg.thinking) {
          const thinkingDiv = document.createElement("div");
          thinkingDiv.className = "thinking-steps";
          
          // Add different style class for CoD
          if (msg.reasoningMethod && msg.reasoningMethod.startsWith("COD")) {
            thinkingDiv.classList.add("cod-thinking");
          }
          
          const thinkingLabel = document.createElement("div");
          thinkingLabel.className = "thinking-label";
          thinkingLabel.textContent = msg.reasoningMethod && msg.reasoningMethod.startsWith("COD") ? 
            "Chain of Draft Steps" : "Thinking Steps";
          thinkingDiv.appendChild(thinkingLabel);
          
          // Format thinking steps using the improved formatted steps function
          const thinkingContent = document.createElement("div");
          thinkingContent.innerHTML = formatThinkingSteps(
            msg.thinking, 
            msg.reasoningMethod ? msg.reasoningMethod.toLowerCase() : REASONING_METHOD
          );
          thinkingDiv.appendChild(thinkingContent);
          
          messageContainer.appendChild(thinkingDiv);
        }
        
        // If we have an answer (for CoD, CoT or Standard)
        if (msg.answer) {
          const answerDiv = document.createElement("div");
          answerDiv.className = "final-answer";
          
          const answerLabel = document.createElement("div");
          answerLabel.className = "final-answer-label";
          answerLabel.textContent = "Final Answer";
          answerDiv.appendChild(answerLabel);
          
          const answerContent = document.createElement("div");
          // Use our new formatting function here
          answerContent.innerHTML = transformMessage(formatFinalAnswer(msg.answer));
          answerDiv.appendChild(answerContent);
          
          messageContainer.appendChild(answerDiv);
        }
        
        // If we have neither thinking nor answer (fall back to content)
        if (!msg.thinking && !msg.answer) {
          const contentEl = document.createElement("div");
          contentEl.innerHTML = transformMessage(msg.content);
          messageContainer.appendChild(contentEl);
        }
        
        messageDiv.appendChild(messageContainer);
      } else {
        // Standard rendering for user messages or placeholders
        const contentEl = document.createElement("div");
        contentEl.innerHTML = transformMessage(msg.content);
        messageDiv.appendChild(contentEl);
        
        // NEW: Add file attachments for user messages
        if (msg.sender === "user" && msg.files && msg.files.length > 0) {
          renderFileAttachments(contentEl, msg.files);
        }
      }
      
      // Add word count badge for bot messages (except placeholders)
      if (msg.sender === "bot" && !msg.isPlaceholder && msg.wordCount !== undefined) {
        const wordCountBadge = document.createElement("div");
        wordCountBadge.className = "word-count-badge";
        
        // Calculate token savings if we have CoD
        let badgeText = `${msg.wordCount} words - ${msg.reasoningMethod || REASONING_METHOD.toUpperCase()}`;
        
        wordCountBadge.innerHTML = badgeText;
        
        // Add breakdown of thinking vs answer word counts
        if (msg.thinkingWordCount !== undefined && msg.answerWordCount !== undefined) {
          wordCountBadge.innerHTML += `
            <div class="word-count-breakdown">
              <span class="count-item count-thinking">thinking: ${msg.thinkingWordCount}</span>
              <span class="count-item count-answer">answer: ${msg.answerWordCount}</span>
            </div>
          `;
        }
        
        // If this is a CoD message, add token savings estimate
        if (msg.reasoningMethod && msg.reasoningMethod.startsWith("COD") && thread.messages.length > 1) {
          // Find a similar CoT message (if available) to compare token savings
          const cotMessages = thread.messages.filter(m => 
            m.sender === "bot" && 
            m.reasoningMethod && 
            m.reasoningMethod === "COT" && 
            !m.isPlaceholder
          );
          
          if (cotMessages.length > 0) {
            // Calculate average token savings compared to CoT
            const avgCotWords = cotMessages.reduce((sum, m) => sum + m.wordCount, 0) / cotMessages.length;
            const savings = Math.round(100 - ((msg.wordCount / avgCotWords) * 100));
            
            if (savings > 0) {
              const savingsEl = document.createElement("div");
              savingsEl.className = "token-savings";
              savingsEl.textContent = `${savings}% fewer words than CoT`;
              wordCountBadge.appendChild(savingsEl);
            }
          }
        }
        
        // Append the badge to the message div directly
        messageDiv.appendChild(wordCountBadge);
      }

      chatMessagesDiv.appendChild(messageDiv);
    });
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
  }
  addCodeCopyButtons();
}

// Update sendMessage function to handle file attachments
async function sendMessage(message) {
  // NEW: Analyze problem complexity if enhanced reasoning is enabled
  if (ENHANCED_REASONING_ENABLED && REASONING_ENHANCEMENT === "adaptive") {
    analyzeProblemComplexity(message);
  }
  
  // Process attached files
  const processedFiles = await processFilesForAPI();
  
  // Create a rich message with files if any
  const richMessage = {
    text: message,
    files: processedFiles
  };
  
  // Add user message to UI
  addMessageToCurrentThread(message, "user", false, processedFiles);
  
  // Clear attached files
  attachedFiles = [];
  updateAttachedFilesDisplay();

  if (!MODEL_NAME) {
    const errorMsg = "Error: Please set the Model Name in the Settings.";
    addMessageToCurrentThread(errorMsg, "bot");
    console.error(errorMsg);
    return;
  }

  // Parse message for word count requirements
  const wordCountRequest = parseWordCountRequest(message);
  
  addMessageToCurrentThread("Bot is typing...", "bot", true);
  const thread = threads.find(t => t.id === currentThreadId);
  const placeholderIndex = thread.messages.length - 1;

  // Build messages array with current settings and word count request
  const messagesForApi = buildMessagesForChat(wordCountRequest);

  // Create payload with file attachments
  const payload = {
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    top_p: TOP_P,
    top_k: TOP_K,
    presence_penalty: PRESENCE_PENALTY,
    frequency_penalty: FREQUENCY_PENALTY,
    temperature: TEMPERATURE,
    messages: messagesForApi,
    files: processedFiles.length > 0 ? processedFiles : undefined
  };
  
  console.log(`Sending request with ${REASONING_METHOD} reasoning ${REASONING_METHOD === "cod" ? `(word limit: ${COD_WORD_LIMIT})` : ""}`);
  if (processedFiles.length > 0) {
    console.log(`Attached files: ${processedFiles.length}`);
  }
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

// Finally, update the init function to include file upload initialization
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
    
    initEventListeners();
    console.log("Event listeners initialized");
    
    // NEW: Initialize file upload functionality
    initFileUpload();
    console.log("File upload initialized");
    
    updateCurrentModelDisplay();
    console.log("Model display updated");
    
    // Initialize feedback form
    initFeedbackForm();
    console.log("Feedback form initialized");
    
    // Helper function to create a button that resets the thread
    function createClearThreadButton() {
      const clearThreadBtn = document.createElement("button");
      clearThreadBtn.id = "clearThreadBtn";
      clearThreadBtn.textContent = "Clear Thread";
      clearThreadBtn.style.marginTop = "0.5rem";
      clearThreadBtn.style.backgroundColor = "#553333";
      clearThreadBtn.addEventListener("click", () => {
        if (confirm("Clear all messages in this thread?")) {
          const thread = threads.find(t => t.id === currentThreadId);
          if (thread) {
            thread.messages = [];
            renderCurrentThreadMessages();
            showNotification("Thread cleared");
          }
        }
      });
      return clearThreadBtn;
    }
    
    // Add clear thread button to the sidebar
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      sidebar.appendChild(createClearThreadButton());
    }
    
    // If we don't have a model name, open settings modal
    if (!MODEL_NAME) {
      console.log("No model name found, opening settings");
      setTimeout(() => {
        try {
          openSettingsModal();
          console.log("Settings modal opened");
        } catch (err) {
          console.error("Error opening settings modal:", err);
        }
      }, 1000);
    }
  } catch (err) {
    console.error("Initialization error:", err);
  }
}
