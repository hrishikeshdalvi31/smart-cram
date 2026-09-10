// ============================================================
// ===== API CONFIGURATION - ADD YOUR API KEYS HERE (UPDATED FOR GEMINI V1) =====
// ============================================================
const API_CONFIG = {
  
  GEMINI_API_KEY: 'YOUR_GEMINI_KEY_HERE',
  YOUTUBE_API_KEY: 'YOUR_YOUTUBE_API_KEY_HERE', 
  GEMINI_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1/models/',
  GEMINI_MODEL: 'gemini-2.5-flash',

  OPENAI_API_KEY: 'YOUR_OPENAI_API_KEY_HERE',
  OPENAI_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  OPENAI_MODEL: 'gpt-3.5-turbo',

  CLAUDE_API_KEY: 'YOUR_CLAUDE_API_KEY_HERE',
  CLAUDE_ENDPOINT: 'https://api.anthropic.com/v1/messages',
  CLAUDE_MODEL: 'claude-3-sonnet-20240229',

  ACTIVE_AI: 'gemini',
  AUTO_FALLBACK: false
};

// Application State
const state = {
  selectedSubject: null,
  videoSearchResults: [],
  currentVideoTopic: null,
  selectedPaper: null,
  currentView: "hero",
  currentFlashcard: 0,
  isFlashcardFlipped: false,
  selectedQuestion: null,
  chatMessages: [
    {
      type: "bot",
      content: "Hello! I'm your AI study assistant. How can I help you today?"
    }
  ],
  cheatsheets: [],
  loadedQuestions: {},
  loadedFlashcards: {},
  selectedText: "",
  selectionPosition: { x: 0, y: 0 },
  currentCheatsheet: null,
  generatedFlashcards: [],
  pdfText: null,
  pdfChapters: {},
  currentHighlightData: null // Store current highlight overlay data
};
const STORAGE_KEY = "smart_cram_user_data";

function saveUserData() {
  const data = {
    cheatsheets: state.cheatsheets,
    chatMessages: state.chatMessages,
    generatedFlashcards: state.generatedFlashcards
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadUserData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (data.cheatsheets) state.cheatsheets = data.cheatsheets;
    if (data.chatMessages) state.chatMessages = data.chatMessages;
    if (data.generatedFlashcards) state.generatedFlashcards = data.generatedFlashcards;
  } catch (err) {
    console.error("Failed to load saved data:", err);
  }
}

function clearUserData() {
  localStorage.removeItem(STORAGE_KEY);
  state.cheatsheets = [];
  state.chatMessages = [{
    type: "bot",
    content: "Hello! I'm your AI study assistant. How can I help you today?"
  }];
  state.generatedFlashcards = [];
  updateCheatsheetsDropdown();
  updateChatMessages();
}

// ============================================================
// ===== CHAPTER CONFIGURATION =====
// ============================================================
const CHAPTER_CONFIG = {
  history: {
    chapters: [
      {
        name: "The Rise of Nationalism in Europe",
        pageStart: 3,
        pageEnd: 25,
        keywords: ["nationalism", "europe", "french revolution", "napoleon", "unification", "italy", "germany"]
      },
      {
        name: "Nationalism in Indo-China",
        pageStart: 25,
        pageEnd: 49,
        keywords: ["indo-china", "vietnam", "french colonial", "ho chi minh", "tonkin", "annam", "cochin china"]
      },
      {
        name: "Nationalism in India",
        pageStart: 49,
        pageEnd: 77,
        keywords: ["india", "gandhi", "non-cooperation", "civil disobedience", "salt march", "khilafat", "rowlatt"]
      },
      {
        name: "The Making of a Global World",
        pageStart: 77,
        pageEnd: 97,
        keywords: ["globalization", "trade", "migration", "silk routes", "food travels", "nineteenth century"]
      },
      {
        name: "The Age of Industrialisation",
        pageStart: 97,
        pageEnd: 117,
        keywords: ["industrial revolution", "factories", "britain", "spinning jenny", "steam engine", "coal"]
      },
      {
        name: "Work, Life and Leisure",
        pageStart: 117,
        pageEnd: 141,
        keywords: ["london", "bombay", "city", "urbanization", "leisure", "cinema", "housing"]
      },
      {
        name: "Print Culture and the Modern World",
        pageStart: 141,
        pageEnd: 159,
        keywords: ["print", "printing press", "gutenberg", "books", "newspapers", "censorship", "reformation"]
      }
    ]
  }
};

const CONFIG = {
  textbookPaths: {
    history: "NCERT-Class-10-History.pdf"
  },

  questionPaperPaths: {
    history: {
      "2024-25": "2024-25_history.json",
      "2023-24": "2023-24_history.json"
    }
  }
};

const subjects = {
  history: { name: "History", icon: "landmark", color: "history-color" }
};

// ============================================================
// ===== AI INTEGRATION FUNCTIONS (GEMINI) =====
// ============================================================

async function callGemini(userMessage, systemPrompt = null) {
  try {
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${userMessage}`
      : userMessage;

    const fullEndpoint = `${API_CONFIG.GEMINI_ENDPOINT_BASE}${API_CONFIG.GEMINI_MODEL}:generateContent?key=${API_CONFIG.GEMINI_API_KEY}`;

    const response = await fetch(fullEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: fullPrompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Unexpected response format from Gemini API');
    }
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}

async function callAI(userMessage, systemPrompt = null) {
  if (API_CONFIG.ACTIVE_AI === 'gemini') {
    return await callGemini(userMessage, systemPrompt);
  }
  throw new Error('Only Gemini is configured');
}
// ============================================================
// ===== YOUTUBE VIDEO SEARCH FUNCTIONS =====
// ============================================================

async function searchYouTubeVideos(topic) {
  if (API_CONFIG.YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
    showSuccessNotification('❌ Please configure your YouTube API key first!');
    return [];
  }

  try {
    showSuccessNotification('🔍 Searching for videos...');
    
    const searchQuery = encodeURIComponent(topic + ' educational tutorial');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=video&videoDuration=medium&videoEmbeddable=true&maxResults=5&relevanceLanguage=en&key=${API_CONFIG.YOUTUBE_API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      return data.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.medium.url,
        channelTitle: item.snippet.channelTitle,
        publishedAt: new Date(item.snippet.publishedAt).toLocaleDateString()
      }));
    }
    
    return [];
  } catch (error) {
    console.error('YouTube Search Error:', error);
    showSuccessNotification(`❌ Error searching videos: ${error.message}`);
    return [];
  }
}

function showVideoSearchModal() {
  const modal = document.getElementById('video-search-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const input = document.getElementById('video-topic-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function closeVideoSearchModal() {
  const modal = document.getElementById('video-search-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function searchVideos() {
  const input = document.getElementById('video-topic-input');
  if (!input) return;
  
  const topic = input.value.trim();
  
  if (!topic) {
    alert('Please enter a topic to search');
    return;
  }
  
  closeVideoSearchModal();
  
  state.currentVideoTopic = topic;
  state.videoSearchResults = await searchYouTubeVideos(topic);
  
  if (state.videoSearchResults.length > 0) {
    state.currentView = 'videos';
    updateView();
    showSuccessNotification(`✅ Found ${state.videoSearchResults.length} videos!`);
  } else {
    showSuccessNotification('⚠️ No videos found. Try a different topic.');
  }
}

function handleVideoSearchKeypress(event) {
  if (event.key === 'Enter') {
    searchVideos();
  }
}

function updateVideosView() {
  const videosSection = document.getElementById('videos-section');
  const videosList = document.getElementById('videos-list');
  const videosTitle = document.getElementById('videos-title');
  
  if (!videosSection || !videosList || !videosTitle) return;
  
  videosTitle.textContent = `Videos: ${state.currentVideoTopic}`;
  
  if (state.videoSearchResults.length === 0) {
    videosList.innerHTML = `
      <div class="no-videos-message">
        <i class="fas fa-video" style="font-size: 4rem; color: #94a3b8; margin-bottom: 1rem;"></i>
        <h3>No Videos Found</h3>
        <p>Try searching with a different topic</p>
      </div>
    `;
    return;
  }
  
  videosList.innerHTML = state.videoSearchResults.map((video, index) => `
    <div class="video-card" style="animation-delay: ${index * 0.1}s">
      <div class="video-thumbnail" onclick="playVideo('${video.id}')">
        <img src="${video.thumbnail}" alt="${video.title}">
        <div class="play-overlay">
          <i class="fas fa-play-circle"></i>
        </div>
      </div>
      <div class="video-info">
        <h4 class="video-title">${video.title}</h4>
        <p class="video-channel">
          <i class="fas fa-user-circle"></i>
          ${video.channelTitle}
        </p>
        <p class="video-date">
          <i class="fas fa-calendar"></i>
          ${video.publishedAt}
        </p>
        <p class="video-description">${video.description.substring(0, 150)}${video.description.length > 150 ? '...' : ''}</p>
        <div class="video-actions">
          <button class="video-btn primary" onclick="playVideo('${video.id}')">
            <i class="fas fa-play"></i>
            Watch Video
          </button>
          <button class="video-btn secondary" onclick="openInYouTube('${video.id}')">
            <i class="fab fa-youtube"></i>
            Open in YouTube
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function playVideo(videoId) {
  const modal = document.getElementById('video-player-modal');
  const iframe = document.getElementById('video-player-iframe');
  
  if (modal && iframe) {
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    modal.classList.remove('hidden');
  }
}

function closeVideoPlayer() {
  const modal = document.getElementById('video-player-modal');
  const iframe = document.getElementById('video-player-iframe');
  
  if (modal && iframe) {
    iframe.src = '';
    modal.classList.add('hidden');
  }
}

function openInYouTube(videoId) {
  window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
}

// ============================================================
// ===== CHAPTER DETECTION & PDF TEXT EXTRACTION =====
// ============================================================

function detectChapterFromQuestion(questionText, subject) {
  const chapters = CHAPTER_CONFIG[subject]?.chapters || [];
  
  const questionLower = questionText.toLowerCase();
  
  const chapterScores = chapters.map((chapter, index) => {
    let score = 0;
    chapter.keywords.forEach(keyword => {
      if (questionLower.includes(keyword.toLowerCase())) {
        score += 1;
      }
    });
    return { chapter, index, score };
  });
  
  chapterScores.sort((a, b) => b.score - a.score);
  
  if (chapterScores[0].score > 0) {
    return chapterScores[0].chapter;
  }
  
  return null;
}

async function extractPDFChapter(pdfUrl, pageStart, pageEnd, chapterName) {
  try {
    if (typeof pdfjsLib === 'undefined') {
      await loadPDFJS();
    }

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    let chapterText = '';

    for (let pageNum = pageStart; pageNum <= Math.min(pageEnd, pdf.numPages); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      chapterText += `\n--- Page ${pageNum} ---\n${pageText}`;
    }

    return chapterText;
  } catch (error) {
    console.error('PDF chapter extraction error:', error);
    return null;
  }
}

async function extractPDFText(pdfUrl) {
  try {
    if (typeof pdfjsLib === 'undefined') {
      await loadPDFJS();
    }

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n--- Page ${pageNum} ---\n${pageText}`;
    }

    return fullText;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return null;
  }
}

function loadPDFJS() {
  return new Promise((resolve, reject) => {
    if (typeof pdfjsLib !== 'undefined') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ============================================================
// ===== OPTIMIZED PDF HIGHLIGHTING WITH CHAPTER DETECTION =====
// ============================================================

async function highlightInPDF(questionId) {
  if (!state.selectedSubject || !state.selectedPaper) {
    showSuccessNotification('❌ Please select a subject and paper first');
    return;
  }

  const questions = state.loadedQuestions[state.selectedSubject]?.[state.selectedPaper];
  
  if (!questions || questions.length === 0) {
    showSuccessNotification('❌ No questions loaded');
    return;
  }

  const question = questions.find(q => {
    return q.question_id == questionId || 
           q.id == questionId || 
           q.questionid == questionId;
  });

  if (!question) {
    console.error('Question not found. Looking for ID:', questionId);
    showSuccessNotification(`❌ Question ${questionId} not found`);
    return;
  }

  if (API_CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    showSuccessNotification('❌ Please configure your Gemini API key first!');
    return;
  }

  showSuccessNotification('🔍 Detecting chapter and analyzing question...');

  try {
    const detectedChapter = detectChapterFromQuestion(question.text, state.selectedSubject);
    
    if (!detectedChapter) {
      showSuccessNotification('⚠️ Could not detect chapter. Searching entire PDF...');
      await highlightInPDFFullSearch(question);
      return;
    }

    showSuccessNotification(`📖 Found chapter: "${detectedChapter.name}" (Pages ${detectedChapter.pageStart}-${detectedChapter.pageEnd})`);

    const chapterKey = `${state.selectedSubject}_${detectedChapter.name}`;
    if (!state.pdfChapters[chapterKey]) {
      showSuccessNotification(`📄 Extracting chapter text from pages ${detectedChapter.pageStart}-${detectedChapter.pageEnd}...`);
      const pdfUrl = CONFIG.textbookPaths[state.selectedSubject];
      state.pdfChapters[chapterKey] = await extractPDFChapter(
        pdfUrl, 
        detectedChapter.pageStart, 
        detectedChapter.pageEnd,
        detectedChapter.name
      );
      
      if (!state.pdfChapters[chapterKey]) {
        throw new Error('Could not extract chapter text');
      }
    }

    const systemPrompt = `You are a precise text matching assistant. Given a question and a textbook chapter, find the most relevant section that would help answer the question.

Return ONLY the exact text excerpt from the textbook (50-200 words) that is most relevant. If you find multiple relevant sections, return the most important one.

Return format: Just the exact text from the document, nothing else.`;

    const chapterText = state.pdfChapters[chapterKey];
    const tokenEstimate = Math.ceil(chapterText.length / 4);
    
    showSuccessNotification(`🤖 Searching chapter (≈${tokenEstimate} tokens)...`);

    const userPrompt = `Question: "${question.text}"

Chapter: ${detectedChapter.name}
Textbook content (Pages ${detectedChapter.pageStart}-${detectedChapter.pageEnd}):
${chapterText}

Find and return the most relevant excerpt from the textbook that relates to this question. If no relevant content is found, respond with "NOT FOUND".`;

    const response = await callAI(userPrompt, systemPrompt);
    
    if (response && response.length > 20 && !response.includes('NOT FOUND')) {
      highlightTextInPDFViewer(response, question.text, detectedChapter);
      showSuccessNotification(`✅ Found relevant section in "${detectedChapter.name}"!`);
    } else {
      showSuccessNotification('⚠️ Could not find specific section in chapter');
    }
  } catch (error) {
    console.error('PDF Highlighting Error:', error);
    showSuccessNotification(`❌ Error: ${error.message}`);
  }
}

async function highlightInPDFFullSearch(question) {
  try {
    if (!state.pdfText) {
      showSuccessNotification('📄 Extracting text from entire PDF...');
      const pdfUrl = CONFIG.textbookPaths[state.selectedSubject];
      state.pdfText = await extractPDFText(pdfUrl);
      
      if (!state.pdfText) {
        throw new Error('Could not extract PDF text');
      }
    }

    const systemPrompt = `You are a precise text matching assistant. Given a question and a textbook, find the most relevant section that would help answer the question.

Return ONLY the exact text excerpt from the textbook (50-200 words) that is most relevant.

Return format: Just the exact text from the document, nothing else.`;

    const chunkSize = 20000;
    let relevantText = '';
    
    for (let i = 0; i < state.pdfText.length; i += chunkSize) {
      const chunk = state.pdfText.substring(i, i + chunkSize);
      const userPrompt = `Question: "${question.text}"

Textbook content:
${chunk}

Find and return the most relevant excerpt from the textbook that relates to this question. If no relevant content is found, respond with "NOT FOUND".`;

      const response = await callAI(userPrompt, systemPrompt);
      
      if (response && response.length > 20 && !response.includes('NOT FOUND')) {
        relevantText = response;
        break;
      }
    }

    if (relevantText && relevantText.length > 20) {
      highlightTextInPDFViewer(relevantText, question.text, null);
      showSuccessNotification(`✅ Found relevant section!`);
    } else {
      showSuccessNotification('⚠️ Could not find specific section in PDF');
    }
  } catch (error) {
    console.error('Full PDF Search Error:', error);
    showSuccessNotification(`❌ Error: ${error.message}`);
  }
}

function highlightTextInPDFViewer(relevantText, questionText, chapter) {
  const existingOverlay = document.getElementById('highlight-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Store the current highlight data in state
  state.currentHighlightData = {
    question: questionText,
    answer: relevantText,
    chapter: chapter
  };

  const chatPanel = document.getElementById('chat-panel');
  const isChatOpen = chatPanel && !chatPanel.classList.contains('hidden');

  const overlay = document.createElement('div');
  overlay.id = 'highlight-overlay';
  
  const rightPosition = isChatOpen ? '420px' : '20px';
  
  overlay.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: ${rightPosition};
    background: linear-gradient(135deg, #0f766e, #14b8a6);
    color: white;
    padding: 0;
    border-radius: 0.75rem;
    width: 400px;
    max-height: 70vh;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 1000;
    animation: slideInUp 0.3s ease-out;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: right 0.3s ease;
  `;

  const chapterInfo = chapter ? `
    <div style="background: rgba(255,255,255,0.15); padding: 0.5rem; border-radius: 0.5rem; margin-bottom: 0.75rem;">
      <strong style="font-size: 0.8rem;">📖 ${chapter.name}</strong>
      <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 0.25rem;">Pages ${chapter.pageStart}-${chapter.pageEnd}</div>
    </div>
  ` : '';

  overlay.innerHTML = `
    <div style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.2); flex-shrink: 0;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
        <strong style="font-size: 0.875rem;">📍 Relevant Section Found</strong>
        <button onclick="document.getElementById('highlight-overlay').remove(); state.currentHighlightData = null;" 
                style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.25rem; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.2)'"
                onmouseout="this.style.background='transparent'">
          ×
        </button>
      </div>
      ${chapterInfo}
      <div style="font-size: 0.75rem; opacity: 0.9; background: rgba(255,255,255,0.1); padding: 0.5rem; border-radius: 0.5rem; margin-bottom: 0.75rem;">
        <strong>Question:</strong> ${questionText.length > 150 ? questionText.substring(0, 150) + '...' : questionText}
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button onclick="addHighlightToCheatsheet('question')" 
                style="flex: 1; background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.25rem;"
                onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                onmouseout="this.style.background='rgba(255,255,255,0.2)'">
          <i class="fas fa-plus" style="font-size: 0.7rem;"></i>
          Add Question
        </button>
        <button onclick="addHighlightToCheatsheet('answer')" 
                style="flex: 1; background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.25rem;"
                onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                onmouseout="this.style.background='rgba(255,255,255,0.2)'">
          <i class="fas fa-plus" style="font-size: 0.7rem;"></i>
          Add Answer
        </button>
        <button onclick="addHighlightToCheatsheet('both')" 
                style="flex: 1; background: rgba(255,255,255,0.3); border: none; color: white; padding: 0.5rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.25rem; font-weight: bold;"
                onmouseover="this.style.background='rgba(255,255,255,0.4)'"
                onmouseout="this.style.background='rgba(255,255,255,0.3)'">
          <i class="fas fa-plus-circle" style="font-size: 0.7rem;"></i>
          Add Both
        </button>
      </div>
    </div>
    <div style="flex: 1; overflow-y: auto; padding: 1rem;">
      <div style="background: rgba(255,255,255,0.1); padding: 0.75rem; border-radius: 0.5rem;">
        <p style="font-size: 0.875rem; margin: 0; line-height: 1.6; white-space: pre-wrap;">${relevantText}</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const originalToggleChat = window.toggleChat;
  window.toggleChat = function() {
    originalToggleChat();
    setTimeout(() => {
      const overlay = document.getElementById('highlight-overlay');
      if (overlay) {
        const chatPanel = document.getElementById('chat-panel');
        const isChatOpen = chatPanel && !chatPanel.classList.contains('hidden');
        overlay.style.right = isChatOpen ? '420px' : '20px';
      }
    }, 50);
  };

  setTimeout(() => {
    if (overlay && overlay.parentElement) {
      overlay.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        overlay.remove();
        state.currentHighlightData = null;
      }, 300);
    }
  }, 60000);
}

// ============================================================
// ===== ADD HIGHLIGHT TO CHEATSHEET FUNCTION =====
// ============================================================

function addHighlightToCheatsheet(type) {
  if (!state.currentHighlightData) {
    showSuccessNotification('❌ No highlight data available');
    return;
  }

  let contentToAdd = '';
  
  switch(type) {
    case 'question':
      contentToAdd = `Q: ${state.currentHighlightData.question}`;
      break;
    case 'answer':
      contentToAdd = `A: ${state.currentHighlightData.answer}`;
      break;
    case 'both':
      contentToAdd = `Q: ${state.currentHighlightData.question}\n\nA: ${state.currentHighlightData.answer}`;
      break;
  }

  if (state.cheatsheets.length === 0) {
    state.selectedText = contentToAdd;
    showCheatsheetSelectModal(true);
  } else {
    state.selectedText = contentToAdd;
    showHighlightCheatsheetSelectModal(type);
  }
}

function showHighlightCheatsheetSelectModal(type) {
  const modal = document.getElementById('cheatsheet-select-modal');
  const preview = document.getElementById('selected-text-preview');
  const list = document.getElementById('cheatsheet-list');

  if (!modal || !preview || !list) return;

  const typeLabel = type === 'question' ? 'Question' : type === 'answer' ? 'Answer' : 'Question & Answer';
  const truncatedText = state.selectedText.length > 100
    ? state.selectedText.substring(0, 100) + "..."
    : state.selectedText;

  preview.innerHTML = `<p><strong>Adding ${typeLabel}:</strong></p><p style="white-space: pre-wrap;">"${truncatedText}"</p>`;

  list.innerHTML = state.cheatsheets
    .map(cheatsheet => `
      <div class="cheatsheet-select-item" onclick="addTextToCheatsheet('${cheatsheet.name.replace(/'/g, "\\'")}')">
        <i class="fas fa-sticky-note"></i>
        <span>${cheatsheet.name}</span>
        <i class="fas fa-chevron-right"></i>
      </div>
    `)
    .join("");

  modal.classList.remove("hidden");
}

// ============================================================
// ===== FILE LOADING & CONFIGURATION =====
// ============================================================

async function loadQuestionPaper(subject, year) {
  const filePath = CONFIG.questionPaperPaths[subject]?.[year];
  if (!state.loadedQuestions[subject]) state.loadedQuestions[subject] = {};

  let questions = [];
  try {
    const resp = await fetch(filePath);
    questions = await resp.json();
  } catch (err) {
    console.error('Failed to load questions for', subject, year, err);
    questions = [];
  }

  state.loadedQuestions[subject][year] = questions.map((q, i) => ({
    question_id: q.question_id || q.id || q.questionid || i + 1,
    text: q.text,
    marks: q.marks,
    section: q.section || ''
  }));

  return state.loadedQuestions[subject][year];
}

function getAvailablePapers(subject) {
  return Object.keys(CONFIG.questionPaperPaths[subject] || {});
}

// ============================================================
// ===== APPLICATION INITIALIZATION & DOM LISTENERS =====
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", e => {
    if (!e.target.closest(".dropdown")) {
      closeAllDropdowns();
    }
  });

  initializeTextSelection();
  loadUserData();
  populateSubjectsDropdown();
  updateCheatsheetsDropdown();
  updateView();
  updateNavigation();
});

// ============================================================
// ===== HELPER FUNCTIONS (NOTIFICATIONS) =====
// ============================================================

function showSuccessNotification(message) {
  const notification = document.createElement("div");
  notification.className = "success-notification";
  notification.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${message}</span>
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

// ============================================================
// ===== NAVIGATION & DROPDOWN FUNCTIONS =====
// ============================================================

function navigateHome() {
  state.currentView = "hero";
  state.selectedSubject = null;
  state.selectedPaper = null;
  state.selectedQuestion = null;
  state.currentCheatsheet = null;
  updateView();
  updateNavigation();
}

function selectSubject(subjectId) {
  state.selectedSubject = subjectId;
  state.selectedPaper = null;
  state.currentView = "study";
  state.selectedQuestion = null;
  state.pdfText = null; 
  state.pdfChapters = {};
  updateView();
  updateNavigation();
  closeAllDropdowns();
}

async function selectPaper(paperId) {
  if (!state.selectedSubject) {
    alert("Please select a subject first!");
    return;
  }

  state.selectedPaper = paperId;
  state.currentView = "study";
  state.selectedQuestion = null;

  await loadQuestionPaper(state.selectedSubject, paperId);

  updateView();
  closeAllDropdowns();
}

async function showFlashcards() {
  state.currentView = "flashcards";
  state.currentFlashcard = 0;
  state.isFlashcardFlipped = false;
  updateView();
}

function backToHome() {
  navigateHome();
}

function toggleDropdown(dropdownId) {
  const dropdown = document.getElementById(dropdownId + "-dropdown");
  const isOpen = dropdown.classList.contains("show");

  closeAllDropdowns();

  if (!isOpen) {
    dropdown.classList.add("show");
  }
}

function closeAllDropdowns() {
  const dropdowns = document.querySelectorAll(".dropdown-content");
  dropdowns.forEach(dropdown => dropdown.classList.remove("show"));
}

function populateSubjectsDropdown() {
  const subjectsDropdown = document.getElementById('subjects-dropdown');
  subjectsDropdown.innerHTML = ''; 

  for (const id in subjects) {
    const subject = subjects[id];
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.onclick = () => selectSubject(id);
    item.innerHTML = `
      <div class="subject-color ${subject.color}"></div>
      <i class="fas fa-${subject.icon}"></i>
      <span>${subject.name}</span>
    `;
    subjectsDropdown.appendChild(item);
  }
}

function populateDropdowns() {
  const papersDropdown = document.getElementById("papers-dropdown");
  if (papersDropdown && state.selectedSubject) {
    const existingItems = papersDropdown.querySelectorAll(".dropdown-item");
    existingItems.forEach(item => item.remove());

    const papers = getAvailablePapers(state.selectedSubject);
    
    papers.forEach(paper => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerHTML = `
        <i class="fas fa-calendar"></i>
        <span>${paper}</span>
      `;
      item.onclick = e => {
        e.preventDefault();
        selectPaper(paper);
      };
      papersDropdown.appendChild(item);
    });
  }
}

// ============================================================
// ===== VIEW & PANEL UPDATE FUNCTIONS =====
// ============================================================

function updateView() {
  document.getElementById("hero-section").classList.add("hidden");
  document.getElementById("videos-section").classList.add("hidden");
  document.getElementById("study-section").classList.add("hidden");
  document.getElementById("flashcards-section").classList.add("hidden");
  document.getElementById("cheatsheet-viewer-section").classList.add("hidden");

  switch (state.currentView) {
    case "hero":
      document.getElementById("hero-section").classList.remove("hidden");
      break;
    case "videos": // ADD THIS CASE
      document.getElementById("videos-section").classList.remove("hidden");
      updateVideosView();
      break;
    case "study":
      document.getElementById("study-section").classList.remove("hidden");
      updateStudyView();
      break;
    case "flashcards":
      document.getElementById("flashcards-section").classList.remove("hidden");
      updateFlashcardsView();
      break;
    case "cheatsheet-viewer":
      document.getElementById("cheatsheet-viewer-section").classList.remove("hidden");
      updateCheatsheetViewer();
      break;
  }
}

function updateNavigation() {
  const papersBtn = document.getElementById("papers-btn");
  if (papersBtn) {
    papersBtn.disabled = !state.selectedSubject;
  }
}

function updateStudyView() {
  const studyTitle = document.getElementById("study-title");
  const questionsPanel = document.getElementById("questions-panel");
  const studyPanels = document.querySelector(".study-panels");
  const pdfViewer = document.getElementById("pdf-viewer");

  if (state.selectedSubject) {
    const subject = subjects[state.selectedSubject];
    const titleText = state.selectedPaper
      ? `${subject.name} - ${state.selectedPaper} Question Paper`
      : `${subject.name} - Textbook`;
    studyTitle.textContent = titleText;

    document.getElementById("pdf-title").textContent = `${subject.name} Textbook`;
    const pdfPath = CONFIG.textbookPaths[state.selectedSubject];

    if (pdfViewer) {
      pdfViewer.innerHTML = `
        <iframe 
          src="${pdfPath}#toolbar=1&navpanes=0&scrollbar=1" 
          width="100%" 
          height="100%" 
          style="border: none; border-radius: 8px; display: block; min-height: 500px;"
          title="${subject.name} Textbook PDF">
          <p>Your browser does not support PDFs. 
              <a href="${pdfPath}" target="_blank">Download the PDF</a> instead.
          </p>
        </iframe>
      `;
    }

    if (state.selectedPaper && state.loadedQuestions[state.selectedSubject]?.[state.selectedPaper]) {
      questionsPanel.classList.remove("hidden");
      studyPanels.classList.remove("full-width");
      updateQuestionsPanel();
    } else {
      questionsPanel.classList.add("hidden");
      studyPanels.classList.add("full-width");
    }

    populateDropdowns();
  } else {
     if (pdfViewer) {
      pdfViewer.innerHTML = `
        <div class="pdf-placeholder">
            <i class="fas fa-book"></i>
            <h4>PDF Viewer</h4>
            <p>Select a subject to view textbook</p>
            <p class="pdf-note">PDF will load here when you select a subject</p>
        </div>
      `;
    }
  }
}

function updateQuestionsPanel() {
  const questionsContent = document.getElementById("questions-content");
  const questionsTitle = document.getElementById("questions-title");

  questionsTitle.textContent = `Questions - ${state.selectedPaper}`;

  const questions = state.loadedQuestions[state.selectedSubject]?.[state.selectedPaper] || [];
  questionsContent.innerHTML = "";

  questions.forEach((question, index) => {
    const questionCard = createQuestionCard(question, index);
    questionsContent.appendChild(questionCard);
  });
}

function createQuestionCard(question, index) {
  const card = document.createElement("div");
  card.className = `question-card ${state.selectedQuestion === question.question_id ? "selected" : ""}`;
  card.onclick = () => selectQuestion(question.question_id);

  card.style.animationDelay = `${index * 0.05}s`;

  let cleanedText = question.text;
  cleanedText = cleanedText.replace(/\[?\d+\s*marks?\]?/gi, "");
  cleanedText = cleanedText.replace(/\(\d+m\)/gi, "");
  cleanedText = cleanedText.replace(/marks?\s*:\s*\d+/gi, "");

  const formattedText = cleanedText.replace(/\n/g, "<br>");
  const escapedText = cleanedText.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
  const qId = question.question_id;

  card.innerHTML = `
    <div class="question-header">
      <span class="question-badge">Q${qId} • ${question.marks} mark${question.marks > 1 ? "s" : ""}</span>
      <span class="section-badge">${question.section}</span>
    </div>
    <p class="question-text">${formattedText}</p>
    <div class="question-actions-always">
      <button class="highlight-btn" onclick="event.stopPropagation(); highlightInPDF('${qId}')">
        <i class="fas fa-highlighter"></i>
        Highlight in PDF
      </button>
    </div>
    ${state.selectedQuestion === qId ? `
      <div class="question-actions">
        <button class="action-btn" data-question="${escapedText}">
          <i class="fas fa-robot"></i>
          Explain with AI
        </button>
        <button class="action-btn secondary" onclick="event.stopPropagation(); getAnswer('${qId}')">
          <i class="fas fa-check-circle"></i>
          Get Answer
        </button>
      </div>
    ` : ""}
  `;
  
  if (state.selectedQuestion === qId) {
    const explainBtn = card.querySelector('[data-question]');
    if (explainBtn) {
      explainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        explainWithAI(cleanedText);
      });
    }
  }

  return card;
}

function selectQuestion(questionId) {
  state.selectedQuestion = state.selectedQuestion === questionId ? null : questionId;
  updateQuestionsPanel();
}

// ============================================================
// ===== AI QUESTION ASSISTANCE =====
// ============================================================

async function explainWithAI(questionText) {
  if (API_CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    alert('Please configure your Gemini API key in the API_CONFIG section first!');
    return;
  }

  toggleChat();
  addChatMessage("user", `Explain this question: ${questionText}`);

  const loadingId = Date.now();
  addChatMessage("bot", `<div id="loading-${loadingId}"><i class="fas fa-spinner fa-spin"></i> Analyzing question with AI...</div>`);

  try {
    const systemPrompt = "You are a helpful history tutor. Explain the question clearly and provide key points to answer it effectively.";
    const response = await callAI(questionText, systemPrompt);

    const loadingElem = document.getElementById(`loading-${loadingId}`);
    if (loadingElem && loadingElem.parentElement) {
      loadingElem.parentElement.remove();
    }

    addChatMessage("bot", response);
  } catch (error) {
    const loadingElem = document.getElementById(`loading-${loadingId}`);
    if (loadingElem && loadingElem.parentElement) {
      loadingElem.parentElement.remove();
    }

    addChatMessage("bot", `Sorry, I encountered an error: ${error.message}. Please check your API key and try again.`);
    console.error("AI Error:", error);
  }
}

async function getAnswer(questionId) {
  if (!state.selectedSubject || !state.selectedPaper) {
    alert('Please select a subject and paper first!');
    return;
  }

  const questions = state.loadedQuestions[state.selectedSubject]?.[state.selectedPaper];
  
  if (!questions || questions.length === 0) {
    alert('No questions loaded');
    return;
  }

  const question = questions.find(q => {
    return q.question_id == questionId || 
           q.id == questionId || 
           q.questionid == questionId;
  });

  if (!question) {
    alert('Question not found');
    return;
  }

  if (API_CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    alert('Please configure your Gemini API key in the API_CONFIG section first!');
    return;
  }

  toggleChat();
  addChatMessage("user", `Give me a full exam answer for: ${question.text}`);

  const loadingId = Date.now();
  addChatMessage("bot", `<div id="loading-${loadingId}"><i class="fas fa-spinner fa-spin"></i> Generating exam-ready answer...</div>`);

  try {
    const systemPrompt = `You are an expert history tutor. Write a complete, exam-ready answer for the given question in 150–200 words. Use proper paragraphing, factual details, and key terms. Avoid bullet points unless the question explicitly asks for "list" or "features". The tone should be academic but easy to memorize.`;

    const response = await callAI(question.text, systemPrompt);

    const loadingElem = document.getElementById(`loading-${loadingId}`);
    if (loadingElem && loadingElem.parentElement) {
      loadingElem.parentElement.remove();
    }

    addChatMessage("bot", response);
  } catch (error) {
    const loadingElem = document.getElementById(`loading-${loadingId}`);
    if (loadingElem && loadingElem.parentElement) {
      loadingElem.parentElement.remove();
    }

    addChatMessage("bot", `Sorry, there was an issue generating the full answer: ${error.message}. Please try again.`);
    console.error("Get Answer Error:", error);
  }
}

// ============================================================
// ===== FLASHCARDS FUNCTIONS =====
// ============================================================

function updateFlashcardsView() {
  const flashcardsTitle = document.getElementById("flashcards-title");
  const flashcardViewer = document.getElementById("flashcard-viewer");
  const flashcardContent = document.getElementById("flashcard-content");

  flashcardsTitle.textContent = "Flashcards";
  flashcardContent.classList.remove("hidden");
  flashcardViewer.classList.add("hidden");

  if (state.cheatsheets.length === 0) {
    flashcardContent.innerHTML = `
      <div class="no-cheatsheet-message">
        <i class="fas fa-sticky-note" style="font-size: 4rem; color: #94a3b8; margin-bottom: 1rem;"></i>
        <h3>No Cheatsheet Made</h3>
        <p>First make a cheatsheet to generate flashcards</p>
        <button class="create-cheatsheet-btn" onclick="createNewCheatsheet()">
          <i class="fas fa-plus"></i>
          Create Cheatsheet
        </button>
      </div>
    `;
  } else {
    flashcardContent.innerHTML = `
      <div class="cheatsheet-selection">
        <h3>Your Cheatsheets</h3>
        <p>Click on a cheatsheet to view and generate AI-powered flashcards:</p>
        <div class="cheatsheet-options">
          ${state.cheatsheets
            .map(cheatsheet => `
              <div class="cheatsheet-card" onclick="viewCheatsheet('${cheatsheet.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-sticky-note"></i>
                <span>${cheatsheet.name}</span>
                <small>${cheatsheet.items?.length || 0} items</small>
              </div>
            `)
            .join("")}
        </div>
      </div>
    `;
  }
}

function updateFlashcardViewer() {
  const flashcards = state.generatedFlashcards;
  const currentCard = flashcards[state.currentFlashcard];

  if (currentCard) {
    document.getElementById("card-counter").textContent = `${state.currentFlashcard + 1} of ${flashcards.length}`;
    document.getElementById("question-text").textContent = currentCard.question;
    document.getElementById("answer-text").textContent = currentCard.answer;

    const flashcard = document.getElementById("flashcard");
    const flipText = document.getElementById("flip-text");

    if (state.isFlashcardFlipped) {
      flashcard.classList.add("flipped");
      flipText.textContent = "Show Question";
    } else {
      flashcard.classList.remove("flipped");
      flipText.textContent = "Show Answer";
    }
  }
}

function flipCard() {
  state.isFlashcardFlipped = !state.isFlashcardFlipped;
  updateFlashcardViewer();
}

function previousCard() {
  if (state.generatedFlashcards.length === 0) return;
  state.currentFlashcard = (state.currentFlashcard - 1 + state.generatedFlashcards.length) % state.generatedFlashcards.length;
  state.isFlashcardFlipped = false;
  updateFlashcardViewer();
}

function nextCard() {
  if (state.generatedFlashcards.length === 0) return;
  state.currentFlashcard = (state.currentFlashcard + 1) % state.generatedFlashcards.length;
  state.isFlashcardFlipped = false;
  updateFlashcardViewer();
}

// ============================================================
// ===== AI FLASHCARD GENERATION =====
// ============================================================

async function generateFlashcardsFromCheatsheet() {
  if (!state.currentCheatsheet || !state.currentCheatsheet.items || state.currentCheatsheet.items.length === 0) {
    alert("This cheatsheet is empty. Add some content first!");
    return;
  }

  const modal = document.getElementById("flashcard-generation-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeFlashcardGenerationModal() {
  const modal = document.getElementById("flashcard-generation-modal");
  if (modal) modal.classList.add("hidden");
}

async function confirmAIFlashcardGeneration() {
  closeFlashcardGenerationModal();

  if (API_CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    alert('Please configure your Gemini API key in the API_CONFIG section first!');
    return;
  }

  showSuccessNotification("🤖 Generating flashcards with AI... This may take a moment");

  try {
    state.generatedFlashcards = [];

    const fullCheatsheetContent = state.currentCheatsheet.items.map(item => item.text).join('\n---\n');

    const prompt = `
Create multiple flashcard question-answer pairs (aim for at least 10 pairs) from the following content.
Each flashcard should focus on a single key concept or fact.
Return strictly in this format:
Q: [question 1]
A: [answer 1]

Q: [question 2]
A: [answer 2]

Content:
${fullCheatsheetContent}
`;

    const systemPrompt = "You are a helpful flashcard generator. Create multiple concise question-answer pairs suitable for active recall study. The output MUST strictly follow the Q: [question] A: [answer] format, separated by a newline.";

    const response = await callAI(prompt, systemPrompt);

    const qaPairs = [...response.matchAll(/Q:\s*(.+?)\s*A:\s*(.+?)(?=\nQ:|$)/gs)];

    qaPairs.forEach(pair => {
      const questionText = pair[1].trim();
      const answerText = pair[2].trim();

      if (questionText && answerText) {
        state.generatedFlashcards.push({
          question: questionText,
          answer: answerText
        });
      }
    });

    if (state.generatedFlashcards.length === 0) {
      alert("Could not generate flashcards. Please try again. Check your cheatsheet content for sufficient detail.");
      return;
    }

    state.currentView = "flashcards";
    state.currentFlashcard = 0;
    state.isFlashcardFlipped = false;

    document.getElementById("flashcards-section").classList.remove("hidden");
    document.getElementById("cheatsheet-viewer-section").classList.add("hidden");
    document.getElementById("flashcard-content").classList.add("hidden");
    document.getElementById("flashcard-viewer").classList.remove("hidden");

    updateFlashcardViewer();

    showSuccessNotification(`✅ Generated ${state.generatedFlashcards.length} AI-powered flashcards!`);
    saveUserData();
  } catch (error) {
    console.error("Flashcard Generation Error:", error);
    alert(`Error generating flashcards: ${error.message}. Please try again.`);
  }
}

// ============================================================
// ===== CHAT FUNCTIONS (AI Assistant) =====
// ============================================================

function toggleChat() {
  const chatPanel = document.getElementById("chat-panel");
  if (!chatPanel) return;
  chatPanel.classList.toggle("hidden");
}

function addChatMessage(type, content) {
  state.chatMessages.push({ type, content });
  updateChatMessages();
  saveUserData();
}

function updateChatMessages() {
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages) return;

  chatMessages.innerHTML = "";

  state.chatMessages.forEach(message => {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${message.type}-message`;
    messageDiv.innerHTML = `<p>${message.content}</p>`;
    chatMessages.appendChild(messageDiv);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const message = input.value.trim();

  if (message) {
    if (API_CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      alert('Please configure your Gemini API key in the API_CONFIG section first!');
      return;
    }

    addChatMessage("user", message);
    input.value = "";

    const loadingId = Date.now();
    addChatMessage("bot", `<div id="loading-${loadingId}"><i class="fas fa-spinner fa-spin"></i> Thinking...</div>`);

    try {
      const systemPrompt = "You are a helpful AI study assistant for history students. Provide clear, educational responses.";
      const response = await callAI(message, systemPrompt);

      const loadingElem = document.getElementById(`loading-${loadingId}`);
      if (loadingElem && loadingElem.parentElement) {
        loadingElem.parentElement.remove();
      }

      addChatMessage("bot", response);
    } catch (error) {
      const loadingElem = document.getElementById(`loading-${loadingId}`);
      if (loadingElem && loadingElem.parentElement) {
        loadingElem.parentElement.remove();
      }

      addChatMessage("bot", `Sorry, I encountered an error: ${error.message}. Please try again.`);
      console.error("AI Chat Error:", error);
    }
  }
}

function handleChatKeypress(event) {
  if (event.key === "Enter") {
    sendMessage();
  }
}

function clearChat() {
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages) return;

  state.chatMessages = [
    {
      type: "bot",
      content: "Chat cleared. How can I help you now?"
    }
  ];

  updateChatMessages();
  saveUserData();
}

// ============================================================
// ===== TEXT SELECTION & CHEATSHEET ADDITION =====
// ============================================================

function initializeTextSelection() {
  document.addEventListener("mouseup", handleTextSelection);
  document.addEventListener("touchend", handleTextSelection);

  document.addEventListener("mousedown", e => {
    const popup = document.getElementById("selection-popup");
    if (popup && !popup.contains(e.target)) {
      hideSelectionPopup();
    }
  });
}

function handleTextSelection(e) {
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer.parentElement;

      const isPdfSelection = container.closest("#pdf-viewer") !== null;
      const isChatSelection = container.closest("#chat-messages") !== null;
      const isCheatsheetSelection = container.closest(".cheatsheet-item-content") !== null;

      if (isPdfSelection || isChatSelection || isCheatsheetSelection) {
        state.selectedText = selectedText;
        showSelectionPopup(e.clientX, e.clientY);
      } else {
        hideSelectionPopup();
      }
    } else {
      hideSelectionPopup();
    }
  }, 10);
}

function showSelectionPopup(x, y) {
  const popup = document.getElementById("selection-popup");
  if (!popup) return;

  popup.classList.remove("hidden");

  let left = x + 10;
  let top = y - 50;

  if (left + 200 > window.innerWidth) {
    left = window.innerWidth - 210;
  }

  if (top < 10) {
    top = y + 20;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function hideSelectionPopup() {
  const popup = document.getElementById("selection-popup");
  if (!popup) return;
  popup.classList.add("hidden");
}

function addToCheatsheet() {
  hideSelectionPopup();

  if (state.cheatsheets.length === 0) {
    showCheatsheetSelectModal(true);
  } else {
    showCheatsheetSelectModal(false);
  }
}

function showCheatsheetSelectModal(createOnly = false) {
  const modal = document.getElementById("cheatsheet-select-modal");
  const preview = document.getElementById("selected-text-preview");
  const list = document.getElementById("cheatsheet-list");

  if (!modal || !preview || !list) return;

  const truncatedText = state.selectedText.length > 100
    ? state.selectedText.substring(0, 100) + "..."
    : state.selectedText;

  preview.innerHTML = `<p><strong>Selected text:</strong></p><p>"${truncatedText}"</p>`;

  if (createOnly) {
    list.innerHTML = '<p class="no-cheatsheets-msg">No cheatsheets exist yet. Create your first one!</p>';
  } else {
    list.innerHTML = state.cheatsheets
      .map(cheatsheet => `
        <div class="cheatsheet-select-item" onclick="addTextToCheatsheet('${cheatsheet.name.replace(/'/g, "\\'")}')">
          <i class="fas fa-sticky-note"></i>
          <span>${cheatsheet.name}</span>
          <i class="fas fa-chevron-right"></i>
        </div>
      `)
      .join("");
  }

  modal.classList.remove("hidden");
}

function closeCheatsheetSelectModal() {
  const modal = document.getElementById("cheatsheet-select-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
  state.selectedText = "";
  window.getSelection().removeAllRanges();
}

function createNewCheatsheetFromSelection() {
  closeCheatsheetSelectModal();
  const modal = document.getElementById("cheatsheet-modal");
  if (modal) modal.classList.remove("hidden");
}

function addTextToCheatsheet(cheatsheetName) {
  const cheatsheet = state.cheatsheets.find(c => c.name === cheatsheetName);

  if (cheatsheet) {
    if (!cheatsheet.items) {
      cheatsheet.items = [];
    }

    cheatsheet.items.push({
      text: state.selectedText,
      addedAt: new Date().toISOString(),
      source: state.currentView === "study" ? "PDF" : state.currentView === "cheatsheet-viewer" ? "Cheatsheet" : "Chat"
    });

    showSuccessNotification(`Added to "${cheatsheetName}"`);
    closeCheatsheetSelectModal();
    saveUserData();
  }
}

// ============================================================
// ===== CHEATSHEET MANAGEMENT =====
// ============================================================

function createNewCheatsheet() {
  const modal = document.getElementById("cheatsheet-modal");
  if (modal) modal.classList.remove("hidden");
  closeAllDropdowns();
}

function closeCheatsheetModal() {
  const modal = document.getElementById("cheatsheet-modal");
  if (modal) modal.classList.add("hidden");
  const nameInput = document.getElementById("cheatsheet-name");
  if (nameInput) nameInput.value = "";
}

function createCheatsheet() {
  const nameInput = document.getElementById("cheatsheet-name");
  if (!nameInput) return;
  const name = nameInput.value.trim();

  if (name) {
    const newCheatsheet = {
      name: name,
      path: `/data/cheatsheets/${name.toLowerCase().replace(/\s+/g, "-")}-cheatsheet.json`,
      items: []
    };

    state.cheatsheets.push(newCheatsheet);

    if (state.selectedText) {
      newCheatsheet.items.push({
        text: state.selectedText,
        addedAt: new Date().toISOString(),
        source: state.currentView === "study" ? "PDF" : "Chat"
      });
      showSuccessNotification(`Created "${name}" and added text`);
      state.selectedText = "";
      window.getSelection().removeAllRanges();
    } else {
      showSuccessNotification(`Created cheatsheet "${name}"`);
    }

    updateCheatsheetsDropdown();
    closeCheatsheetModal();
    saveUserData();
  }
}

function handleCheatsheetKeypress(event) {
  if (event.key === "Enter") {
    createCheatsheet();
  }
}

function updateCheatsheetsDropdown() {
  const cheatsheetsDropdown = document.getElementById("cheatsheets-dropdown");
  if (cheatsheetsDropdown) {
    const existingItems = cheatsheetsDropdown.querySelectorAll(
      ".dropdown-item:not([onclick*='createNewCheatsheet'])"
    );
    existingItems.forEach(item => item.remove());

    state.cheatsheets.forEach(cheatsheet => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerHTML = `
        <i class="fas fa-sticky-note"></i>
        <span>${cheatsheet.name}</span>
      `;
      item.onclick = e => {
        e.preventDefault();
        viewCheatsheet(cheatsheet.name);
      };
      const createNewItem = cheatsheetsDropdown.querySelector("[onclick*='createNewCheatsheet']");
      if(createNewItem) {
          cheatsheetsDropdown.insertBefore(item, createNewItem);
      } else {
          cheatsheetsDropdown.appendChild(item);
      }
    });
  }
}

function viewCheatsheet(cheatsheetName) {
  const cheatsheet = state.cheatsheets.find(c => c.name === cheatsheetName);
  if (cheatsheet) {
    state.currentCheatsheet = cheatsheet;
    state.currentView = "cheatsheet-viewer";
    updateView();
    closeAllDropdowns();
  }
}

function updateCheatsheetViewer() {
  const titleElement = document.getElementById("cheatsheet-viewer-title");
  const container = document.getElementById("cheatsheet-items-container");

  if (!container) return;

  if (!state.currentCheatsheet) {
    container.innerHTML = '<p class="no-items-msg">No cheatsheet selected</p>';
    return;
  }

  if (titleElement) {
    titleElement.innerHTML = `
      <i class="fas fa-sticky-note"></i>
      <span>${state.currentCheatsheet.name}</span>
    `;
  }

  if (!state.currentCheatsheet.items || state.currentCheatsheet.items.length === 0) {
    container.innerHTML = `
      <div class="no-items-msg">
        <p>This cheatsheet is empty. Select text from PDFs or chat to add content!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.currentCheatsheet.items
    .map((item, index) => {
      const date = new Date(item.addedAt);
      const formattedDate = date.toLocaleDateString() + " " + date.toLocaleTimeString();

      return `
        <div class="cheatsheet-item" style="animation-delay: ${index * 0.1}s">
          <div class="cheatsheet-item-header">
            <span class="item-number">Item ${index + 1}</span>
            <span class="item-source">${item.source}</span>
            <span class="item-date">${formattedDate}</span>
          </div>
          <div class="cheatsheet-item-content">${item.text}</div>
          <div class="cheatsheet-item-actions">
            <button class="item-action-btn" onclick="deleteCheatsheetItem(${index})">
              <i class="fas fa-trash"></i>
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

function deleteCheatsheetItem(index) {
  if (confirm("Are you sure you want to delete this item?")) {
    state.currentCheatsheet.items.splice(index, 1);
    updateCheatsheetViewer();
    showSuccessNotification("Item deleted");
    saveUserData();
  }
}

// ============================================================
// ===== EXPORT FUNCTIONS (DOCX & PDF) =====
// ============================================================

async function exportCheatsheetAsDocx() {
  if (!state.currentCheatsheet || !state.currentCheatsheet.items.length) {
    alert("No cheatsheet data to export.");
    return;
  }

  showSuccessNotification("📄 Generating Word document...");

  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = window.docx;

    const cheatsheet = state.currentCheatsheet;
    const docChildren = [];

    docChildren.push(
      new Paragraph({
        text: `Cheatsheet: ${cheatsheet.name}`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated on: ${new Date().toLocaleString()}`,
            italics: true,
            color: "666666",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      })
    );

    cheatsheet.items.forEach((item, index) => {
      const date = new Date(item.addedAt).toLocaleString();
      
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ 
              text: `Item ${index + 1}`, 
              bold: true,
              size: 28 
            }),
          ],
          spacing: { before: 300, after: 150 },
        })
      );

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun(item.text),
          ],
          spacing: { after: 150 },
        })
      );

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Source: ${item.source || "N/A"} | Added: ${date}`,
              italics: true,
              color: "666666",
              size: 18,
            }),
          ],
          spacing: { after: 300 },
        })
      );
    });

    const doc = new Document({ 
      sections: [{ 
        children: docChildren 
      }] 
    });

    const blob = await Packer.toBlob(doc);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${cheatsheet.name.replace(/\s+/g, "_")}.docx`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showSuccessNotification("✅ Word document exported successfully!");
  } catch (err) {
    console.error("DOCX export failed:", err);
    alert("Failed to export Word document. Check console for details.");
  }
}

async function exportCheatsheetAsPDF() {
  if (!state.currentCheatsheet || !state.currentCheatsheet.items.length) {
    alert("No cheatsheet data to export.");
    return;
  }

  showSuccessNotification("📄 Generating PDF...");

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ 
      orientation: "p", 
      unit: "pt", 
      format: "a4" 
    });

    const cheatsheet = state.currentCheatsheet;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    const maxWidth = pageWidth - (margin * 2);
    let y = 60;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    const titleLines = pdf.splitTextToSize(`Cheatsheet: ${cheatsheet.name}`, maxWidth);
    pdf.text(titleLines, pageWidth / 2, y, { align: "center" });
    y += (titleLines.length * 24) + 20;

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "italic");
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, y, { align: "center" });
    y += 30;

    pdf.setTextColor(0, 0, 0);
    pdf.setFont("helvetica", "normal");

    cheatsheet.items.forEach((item, index) => {
      if (y > pageHeight - 100) {
        pdf.addPage();
        y = 60;
      }

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text(`Item ${index + 1}`, margin, y);
      y += 20;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      const contentLines = pdf.splitTextToSize(item.text, maxWidth);
      
      if (y + (contentLines.length * 14) > pageHeight - 60) {
        pdf.addPage();
        y = 60;
      }
      
      pdf.text(contentLines, margin, y);
      y += (contentLines.length * 14) + 10;

      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 100, 100);
      const date = new Date(item.addedAt).toLocaleString();
      pdf.text(`Source: ${item.source || "N/A"} | Added: ${date}`, margin, y);
      y += 25;
      
      pdf.setTextColor(0, 0, 0);
    });

    pdf.save(`${cheatsheet.name.replace(/\s+/g, "_")}.pdf`);
    showSuccessNotification("✅ PDF exported successfully!");
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("Failed to export PDF. Check console for details.");
  }
}

function logout() {
  if (confirm("Logout and clear all saved data?")) {
    clearUserData();
    navigateHome();
    showSuccessNotification("Logged out — local data cleared");
  }
}
