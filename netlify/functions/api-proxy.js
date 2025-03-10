/***********************
 * Global Configuration
 ***********************/
let MODEL_NAME = "";
let MODEL_NAME_DISPLAY = "";
    
// Server endpoint (Netlify serverless function)
const API_PROXY_URL = "/.netlify/functions/api-proxy";
    
// Reasoning Method
let REASONING_METHOD = "cod"; // Options: "standard", "cot", "cod"
    
// COD Word Limit
let COD_WORD_LIMIT = 5;
    
// Enhanced reasoning controls
let ENHANCED_REASONING_ENABLED = true;
let REASONING_ENHANCEMENT = "adaptive"; // Options: "adaptive", "standard"
    
// Self-consistency voting
let SELF_CONSISTENCY_ENABLED = false;
let SELF_CONSISTENCY_PATHS = 3;  // Default number of reasoning paths to generate
    
// Problem complexity detection
let PROBLEM_COMPLEXITY = {
  hasMath: false,
  hasLogic: false,
  multiStep: false,
  complexity: "normal" // Options: "simple", "normal", "complex"
};

// Prompts for different reasoning methods
let PROMPTS = {
  standard: "",
  
  cot: `Think step by step to solve this problem. Explain your reasoning at each step, then provide your final answer.`,
  
  cod: `Think step by step, but produce only minimal notes for each step (${COD_WORD_LIMIT} words maximum per step). Use mathematical notation where possible. Keep only essential information needed to solve the problem. Focus on key calculations and intermediate results without narrative explanation.

Separate your steps with periods. Write your final answer after the #### separator.

IMPORTANT: If you need to write code as your answer, you can ignore the word limit for the code portion. Follow these guidelines:
1. Keep your thinking steps concise as usual (${COD_WORD_LIMIT} words per step)
2. When presenting code, place it after the #### separator
3. For code examples, provide complete, detailed implementations without word limits
4. Use proper formatting with code blocks (\`\`\`language) for all code

Examples for problem solving:
Q: Jason had 20 lollipops. He gave Denny some lollipops. Now Jason has 12 lollipops. How many lollipops did Jason give to Denny?
A: 20 initial. 12 remaining. 20 - 12 = 8. #### 8 lollipops

Example for code tasks:
Q: Write a function to find the longest substring without repeating characters.
A: Use sliding window approach. Track characters in set. Expand and contract window based on duplicates. Update max length when needed. #### 
\`\`\`javascript
function lengthOfLongestSubstring(s) {
  // Complete implementation with detailed code
  let maxLength = 0;
  let start = 0;
  const charMap = new Map();
  
  for (let end = 0; end < s.length; end++) {
    const currentChar = s[end];
    
    if (charMap.has(currentChar) && charMap.get(currentChar) >= start) {
      start = charMap.get(currentChar) + 1;
    }
    
    charMap.set(currentChar, end);
    maxLength = Math.max(maxLength, end - start + 1);
  }
  
  return maxLength;
}

// Example usage:
console.log(lengthOfLongestSubstring("abcabcbb")); // Output: 3
console.log(lengthOfLongestSubstring("bbbbb"));    // Output: 1
console.log(lengthOfLongestSubstring("pwwkew"));   // Output: 3
\`\`\``
};

// Enhanced prompts for complex problems with different word limits
let ENHANCED_PROMPTS = {
  cot: `Think step by step to solve this problem. This appears to be a complex problem that requires careful reasoning. Break down your thinking into clear steps, making sure to consider all relevant information and constraints. 

For complex problems, use as many steps as needed to work through the solution thoroughly. It's better to use more steps with clear reasoning than to skip steps.

Check your calculations and logic at each step. After you've completed your reasoning process, provide your final answer.`,
  
  cod5: `Think step by step to solve this complex problem. For each step, use at most 5 words to capture the essential reasoning, but use AS MANY STEPS as needed to thoroughly work through the problem. Use mathematical notation where efficient. Show ALL intermediate calculations and logical inferences.

IMPORTANT: Instead of trying to fit complex reasoning into fewer steps, break your reasoning into more numerous simple steps. For example, instead of one step with "Calculate area using length×width=50×30=1500", use multiple steps:
1. Length = 50.
2. Width = 30.
3. Area = length × width.
4. Area = 50 × 30.
5. Area = 1500.

Separate your steps with periods. Write your final answer after the #### separator.`,

  // Other cod options omitted for brevity
};

// Default generation parameters
let TEMPERATURE = 0.5;
let TOP_P = 0.90;
let TOP_K = 55;
let MAX_TOKENS = 1112;
let PRESENCE_PENALTY = 0;
let FREQUENCY_PENALTY = 0.4;

// Thread Management
let threads = [];
let currentThreadId = null;
let threadCounter = 1;
let attachedFiles = [];

/***********************
 * Thread Management
 ***********************/
function createNewThread() {
  const newThread = {
    id: Date.now(),
    name: `Thread ${threadCounter++}`,
    messages: []
  };
  threads.push(newThread);
  currentThreadId = newThread.id;
  updateThreadList();
  renderCurrentThreadMessages();
  
  // Show status notification
  showNotification("New thread created");
}

function deleteCurrentThread() {
  if (!currentThreadId) return;
  if (confirm("Are you sure you want to delete this thread?")) {
    threads = threads.filter(thread => thread.id !== currentThreadId);
    if (threads.length > 0) {
      currentThreadId = threads[0].id;
    } else {
      createNewThread();
      return;
    }
    updateThreadList();
    renderCurrentThreadMessages();
    showNotification("Thread deleted");
  }
}

function clearCurrentThread() {
  if (!currentThreadId) return;
  if (confirm("Clear all messages in this thread?")) {
    const thread = threads.find(t => t.id === currentThreadId);
    if (thread) {
      thread.messages = [];
      renderCurrentThreadMessages();
      showNotification("Thread cleared");
    }
  }
}

function updateThreadList() {
  const threadList = document.getElementById("threadList");
  if (!threadList) return;
  
  threadList.innerHTML = "";
  threads.forEach(thread => {
    const li = document.createElement("li");
    li.textContent = thread.name;
    if (thread.id === currentThreadId) {
      li.classList.add("active");
    }
    li.addEventListener("click", () => {
      currentThreadId = thread.id;
      renderCurrentThreadMessages();
      updateThreadList();
    });
    threadList.appendChild(li);
  });
}

function renderCurrentThreadMessages() {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;
  
  const thread = threads.find(t => t.id === currentThreadId);
  if (!thread) return;
  
  chatMessages.innerHTML = "";
  
  thread.messages.forEach(msg => {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${msg.sender} ${msg.isPlaceholder ? 'placeholder' : ''}`;
    
    // Handle messages with thinking steps and final answer
    if (msg.sender === 'bot' && !msg.isPlaceholder && (msg.thinking || msg.answer)) {
      const messageContainer = document.createElement("div");
      messageContainer.className = "message-container";
      
      // If there are thinking steps, render them
      if (msg.thinking) {
        const thinkingStepsDiv = document.createElement("div");
        thinkingStepsDiv.className = `thinking-steps ${msg.reasoningMethod === 'COD' || msg.reasoningMethod?.includes('COD') ? 'cod-thinking' : ''}`;
        
        const thinkingLabel = document.createElement("div");
        thinkingLabel.className = "thinking-label";
        thinkingLabel.textContent = "Thinking Steps";
        thinkingStepsDiv.appendChild(thinkingLabel);
        
        // For CoD, format the thinking steps with numbered steps
        if (msg.reasoningMethod === 'COD' || msg.reasoningMethod?.includes('COD')) {
          const steps = msg.thinking.split('.').filter(step => step.trim().length > 0);
          steps.forEach((step, index) => {
            const stepDiv = document.createElement("div");
            stepDiv.className = "cod-step";
            
            const stepNumber = document.createElement("div");
            stepNumber.className = "step-number";
            stepNumber.textContent = index + 1;
            
            const stepContent = document.createElement("div");
            stepContent.className = "step-content";
            stepContent.textContent = step.trim();
            
            stepDiv.appendChild(stepNumber);
            stepDiv.appendChild(stepContent);
            thinkingStepsDiv.appendChild(stepDiv);
          });
        } else {
          // Standard formatting for CoT
          thinkingStepsDiv.innerHTML += msg.thinking;
        }
        
        messageContainer.appendChild(thinkingStepsDiv);
      }
      
      // Render the final answer
      if (msg.answer) {
        const finalAnswerDiv = document.createElement("div");
        finalAnswerDiv.className = "final-answer";
        
        const finalAnswerLabel = document.createElement("div");
        finalAnswerLabel.className = "final-answer-label";
        finalAnswerLabel.textContent = "Final Answer";
        finalAnswerDiv.appendChild(finalAnswerLabel);
        
        // Handle answer content
        finalAnswerDiv.innerHTML += msg.answer;
        
        messageContainer.appendChild(finalAnswerDiv);
      }
      
      // Add word count badge
      if (msg.wordCount) {
        const wordCountBadge = document.createElement("div");
        wordCountBadge.className = "word-count-badge";
        
        let badgeText = `${msg.wordCount} words`;
        
        // Add breakdown if available
        if (msg.thinkingWordCount !== undefined && msg.answerWordCount !== undefined) {
          const wordCountBreakdown = document.createElement("div");
          wordCountBreakdown.className = "word-count-breakdown";
          
          const thinkingCount = document.createElement("span");
          thinkingCount.className = "count-item count-thinking";
          thinkingCount.textContent = `Thinking: ${msg.thinkingWordCount}`;
          
          const answerCount = document.createElement("span");
          answerCount.className = "count-item count-answer";
          answerCount.textContent = `Answer: ${msg.answerWordCount}`;
          
          wordCountBreakdown.appendChild(thinkingCount);
          wordCountBreakdown.appendChild(answerCount);
          
          badgeText += ` (${msg.reasoningMethod || 'COT'})`;
          wordCountBadge.appendChild(document.createTextNode(badgeText));
          wordCountBadge.appendChild(wordCountBreakdown);
        } else {
          wordCountBadge.textContent = badgeText;
        }
        
        messageDiv.appendChild(wordCountBadge);
      }
      
      messageDiv.appendChild(messageContainer);
    } else {
      // Standard message rendering
      messageDiv.innerHTML = msg.content;
      
      // Add word count badge for bot messages
      if (msg.sender === 'bot' && !msg.isPlaceholder && msg.wordCount) {
        const wordCountBadge = document.createElement("div");
        wordCountBadge.className = "word-count-badge";
        wordCountBadge.textContent = `${msg.wordCount} words`;
        messageDiv.appendChild(wordCountBadge);
      }
      
      // Add files to user messages if any
      if (msg.sender === 'user' && msg.files && msg.files.length > 0) {
        addFilesToMessage(messageDiv, msg.files);
      }
    }
    
    chatMessages.appendChild(messageDiv);
  });
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Add code copy buttons
  setTimeout(addCodeCopyButtons, 100);
}

function addMessageToCurrentThread(content, sender, isPlaceholder = false, files = []) {
  const thread = threads.find(t => t.id === currentThreadId);
  if (!thread) return;
  
  const message = {
    content,
    sender,
    isPlaceholder,
    timestamp: new Date(),
    files: files.slice() // Make a copy of the files array
  };
  
  // Calculate word count for bot messages
  if (sender === 'bot' && !isPlaceholder) {
    message.wordCount = countWords(content);
  }
  
  thread.messages.push(message);
  renderCurrentThreadMessages();
}

// Add the remaining functions here...
function countWords(text) {
  // Implementation of countWords function
  // Remove code blocks to get more accurate word count for actual text
  const textWithoutCode = text.replace(/```[\s\S]*?```/g, '');
  
  // Count mathematical expressions as single words
  // First, replace common math expressions with placeholder words
  let processedText = textWithoutCode
    // Replace simple equations (e.g., "x = 5 + 3") with single tokens
    .replace(/\b\w+\s*=\s*[\d\w+\-*/()]+/g, "EQUATION")
    // Replace fractions (e.g., "2/3") with single tokens
    .replace(/\b\d+\/\d+\b/g, "FRACTION")
    // Replace mathematical operations with spaces
    .replace(/[+\-*/=<>]+/g, " ");
  
  // Split by whitespace and filter out empty strings
  const words = processedText.split(/\s+/).filter(word => word.length > 0);
  return words.length;
}

function showNotification(message, duration = 3000) {
  const notification = document.getElementById("statusNotification");
  if (!notification) return;
  
  notification.textContent = message;
  notification.classList.add("show");
  
  setTimeout(() => {
    notification.classList.remove("show");
  }, duration);
}

// Initialize settings and UI
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
    
    updateCurrentModelDisplay();
    console.log("Model display updated");
    
    // Initialize feedback form
    initFeedbackForm();
    console.log("Feedback form initialized");
    
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

function createClearThreadButton() {
  const clearThreadBtn = document.createElement("button");
  clearThreadBtn.id = "clearThreadBtn";
  clearThreadBtn.textContent = "Clear Thread";
  clearThreadBtn.style.marginTop = "0.5rem";
  clearThreadBtn.style.backgroundColor = "#553333";
  clearThreadBtn.addEventListener("click", clearCurrentThread);
  return clearThreadBtn;
}

function initEventListeners() {
  try {
    console.log("Initializing event listeners");
    
    // Helper function to safely add event listeners
    const addListener = (id, event, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, handler);
      } else {
        console.warn(`Element with id "${id}" not found for event listener`);
      }
    };
    
    // Settings buttons
    addListener("openSettings", "click", openSettingsModal);
    addListener("closeSettings", "click", closeSettingsModal);
    addListener("closeModalX", "click", closeSettingsModal);
    addListener("saveSettings", "click", saveSettings);
    
    // Thread management
    addListener("newThreadBtn", "click", createNewThread);
    addListener("deleteThreadBtn", "click", deleteCurrentThread);
    addListener("downloadTxtBtn", "click", downloadCurrentThreadAsTxt);
    addListener("downloadPdfBtn", "click", downloadCurrentThreadAsPdf);
    
    // Message sending
    addListener("sendBtn", "click", () => {
      const userInput = document.getElementById("userInput");
      if (userInput) {
        const message = userInput.value.trim();
        if (message || attachedFiles.length > 0) {
          sendMessage(message);
          userInput.value = "";
        }
      }
    });
    
    const userInput = document.getElementById("userInput");
    if (userInput) {
      userInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const sendBtn = document.getElementById("sendBtn");
          if (sendBtn) sendBtn.click();
        }
      });
    }
    
    // Initialize file upload handling
    handleFileInput();
    
    // Close modal when clicking outside
    window.addEventListener("click", (event) => {
      const settingsModal = document.getElementById("settingsModal");
      if (settingsModal && event.target === settingsModal) {
        closeSettingsModal();
      }
      
      const feedbackModal = document.getElementById("feedbackModal"); 
      if (feedbackModal && event.target === feedbackModal) {
        feedbackModal.style.display = 'none';
      }
    });
    
    // Set up settings UI functionality
    setTimeout(() => {
      try {
        setupTabNavigation();
        setupModelInput();
        setupCODOptions();
        setupEnhancedReasoningOptions();
        setupSliders();
        initSelfConsistency();
        console.log("UI functionality setup complete");
      } catch (err) {
        console.error("Error setting up UI functionality:", err);
      }
    }, 100);
  } catch (err) {
    console.error("Error initializing event listeners:", err);
  }
}

// Settings functionality
function openSettingsModal() {
  try {
    console.log("Opening settings modal");
    
    // Set reasoning method radio buttons
    const reasoningRadio = document.getElementById(`${REASONING_METHOD}Reasoning`);
    if (reasoningRadio) reasoningRadio.checked = true;
    
    // Set enhanced reasoning options
    const enhancedToggle = document.getElementById('enhancedReasoningToggle');
    if (enhancedToggle) enhancedToggle.checked = ENHANCED_REASONING_ENABLED;
    
    const enhancedOptionsContainer = document.getElementById('enhancedReasoningOptions');
    if (enhancedOptionsContainer) {
      enhancedOptionsContainer.style.display = ENHANCED_REASONING_ENABLED ? 'block' : 'none';
    }
    
    const adaptiveRadio = document.getElementById('adaptiveReasoning');
    const standardRadio = document.getElementById('standardReasoning');
    
    if (adaptiveRadio && standardRadio) {
      if (REASONING_ENHANCEMENT === 'adaptive') {
        adaptiveRadio.checked = true;
      } else {
        standardRadio.checked = true;
      }
    }
    
    // Set parameter sliders
    setSliderAndValue("temp", TEMPERATURE);
    setSliderAndValue("topP", TOP_P);
    setSliderAndValue("topK", TOP_K);
    setSliderAndValue("maxTokens", MAX_TOKENS);
    setSliderAndValue("presencePenalty", PRESENCE_PENALTY);
    setSliderAndValue("frequencyPenalty", FREQUENCY_PENALTY);
    
    // Show modal
    const modal = document.getElementById("settingsModal");
    if (modal) {
      modal.style.display = "block";
      
      // Reset tab state - ensure only the first tab is active
      const tabButtons = document.querySelectorAll('.tab-btn');
      const tabContents = document.querySelectorAll('.tab-content');
      
      // Hide all tabs first
      tabContents.forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
      });
      
      // Deactivate all tab buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      
      // Activate only the first tab
      if (tabButtons.length > 0) {
        tabButtons[0].classList.add('active');
        const firstTabId = tabButtons[0].getAttribute('data-tab');
        const firstTabContent = document.getElementById(firstTabId);
        if (firstTabContent) {
          firstTabContent.classList.add('active');
          firstTabContent.style.display = 'block';
        }
      }
    }
    
    console.log("Settings modal opened successfully");
  } catch (err) {
    console.error("Error in openSettingsModal:", err);
  }
}

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "none";
}

// Load settings from localStorage
function loadPersistedSettings() {
  try {
    MODEL_NAME = localStorage.getItem("modelName") || "";
    MODEL_NAME_DISPLAY = getModelDisplayName(MODEL_NAME);
    
    REASONING_METHOD = localStorage.getItem("reasoningMethod") || "cod";
    
    const codWordLimit = localStorage.getItem("codWordLimit");
    if (codWordLimit) COD_WORD_LIMIT = parseInt(codWordLimit);
    
    // Other settings loading code...
    // Add what's needed from the existing code
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

// More functions will need to be defined here...
// For brevity, I'm including only the core functions needed to fix your issues.
// The rest of the functions should be moved from the original file.

// Initialize the app when the DOM is loaded
document.addEventListener("DOMContentLoaded", init);

// Backup initialization - in case the DOMContentLoaded event already fired
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(init, 1);
}
