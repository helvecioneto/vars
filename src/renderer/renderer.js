// ==========================================
// Hearing Agent - Renderer Process
// ==========================================

// State
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let config = {};
let currentInputMode = 'system'; // 'system', 'microphone', 'keyboard'
let currentZoom = 100; // Zoom percentage (70-120)
const MIN_ZOOM = 70;
const MAX_ZOOM = 120;
const ZOOM_STEP = 10;

let isZooming = false; // Flag to pause auto-resize during zoom operations
let zoomTimeout = null;
let historyIndex = -1; // -1 = current/live, 0 = oldest, 1 = middle, 2 = newest


// DOM Elements
const elements = {
    // Main containers
    appContainer: document.getElementById('app-container'),
    contentArea: document.getElementById('content-area'),

    // Toolbar elements
    recBtn: document.getElementById('rec-btn'),
    inputField: document.getElementById('input-field'),
    modeBtn: document.getElementById('mode-btn'),
    modeIcon: document.getElementById('mode-icon'),
    historyBtn: document.getElementById('history-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    dragBtn: document.getElementById('drag-btn'),
    settingsDragBtn: document.getElementById('settings-drag-btn'),

    // Status
    statusBar: document.getElementById('status-bar'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),

    // Content sections
    transcriptionSection: document.getElementById('transcription-section'),
    transcriptionContent: document.getElementById('transcription-content'),
    responseSection: document.getElementById('response-section'),
    responseContent: document.getElementById('response-content'),

    // Settings panel
    settingsPanel: document.getElementById('settings-panel'),
    backBtn: document.getElementById('back-btn'),
    saveBtn: document.getElementById('save-btn'),
    addFileBtn: document.getElementById('add-file-btn'),
    fileInput: document.getElementById('file-input'),

    // Settings inputs
    apiKeyInput: document.getElementById('api-key'),
    modelSelect: document.getElementById('model-select'),
    languageSelect: document.getElementById('language-select'),
    systemPromptInput: document.getElementById('system-prompt'),
    fileList: document.getElementById('file-list'),
    inputDeviceSelect: document.getElementById('input-device'),
    outputDeviceSelect: document.getElementById('output-device'),
    trainBtn: document.getElementById('train-btn'),
    resetKbBtn: document.getElementById('reset-kb-btn'),
    kbStatus: document.getElementById('kb-status'),
    // Brief Mode
    briefModeCheckbox: document.getElementById('brief-mode'),

    // Legacy elements (for compatibility)
    statusIndicator: document.getElementById('status-indicator'),
    recordingSection: document.getElementById('recording-section'),
    recordingIndicator: document.getElementById('recording-indicator'),
    recordingText: document.getElementById('recording-text'),
    minimizeBtn: document.getElementById('minimize-btn'),
    modeBadge: document.getElementById('mode-badge'),
    modeText: document.getElementById('mode-text'),
    keyboardInputSection: document.getElementById('keyboard-input-section'),
    keyboardInput: document.getElementById('keyboard-input'),
    submitKeyboardBtn: document.getElementById('submit-keyboard-btn'),
    emptyState: document.getElementById('empty-state'),
    mainContent: document.getElementById('main-content')
};

// Input mode configuration (only audio modes, text input is always available)
const INPUT_MODES = {
    system: {
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
        text: 'Computer Audio Input',
        color: '#6366f1'
    },
    microphone: {
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
        text: 'Microphone Input',
        color: '#22c55e'
    }
};

// ==========================================
// Initialization
// ==========================================

async function init() {
    // Load config
    config = await window.electronAPI.getConfig();
    currentInputMode = config.inputMode || 'system';

    applyConfigToUI();
    updateInputModeUI();
    await populateDevices();

    // Setup event listeners
    setupEventListeners();

    // Listen for recording toggle from main process
    window.electronAPI.onRecordingToggle(handleRecordingToggle);

    // Listen for input mode changes from main process
    window.electronAPI.onInputModeChanged(handleInputModeChange);

    // Listen for zoom shortcuts from main process
    window.electronAPI.onZoomShortcut((key) => {
        if (key === '+' || key === '=' || key === 'plus') {
            zoomIn();
        } else if (key === '-' || key === 'minus') {
            zoomOut();
        } else if (key === '0') {
            resetZoom();
        }
    });
    // Start bounds tracking for click-through
    startBoundsTracking();

    console.log('Hearing Agent initialized');
}

function startBoundsTracking() {
    // Send bounds less frequently to avoid conflicts with zoom
    setInterval(() => {
        // Skip bounds update if we are currently zooming to prevent resonance loops
        if (isZooming) return;

        if (elements.appContainer) {
            const rect = elements.appContainer.getBoundingClientRect();
            window.electronAPI.sendContentBounds({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
        }
    }, 500); // Slower updates to reduce resize loop risk
}

function setupEventListeners() {
    // Window controls
    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    // Global Context Menu (Right-click anywhere shows Hide/Exit)
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electronAPI.showContextMenu();
    });

    // Drag Logic for Drag Buttons
    function setupDragButton(btn) {
        if (!btn) return;

        // Drag tracking (Drag-Lock)
        btn.addEventListener('mousedown', () => {
            window.electronAPI.setDragging(true);
        });
    }

    // Setup drag buttons
    setupDragButton(elements.dragBtn);
    setupDragButton(elements.settingsDragBtn);

    // Global mouseup to release drag lock from anywhere
    window.addEventListener('mouseup', () => {
        window.electronAPI.setDragging(false);
    });

    // Settings toggle (click to open/close)
    elements.settingsBtn.addEventListener('click', toggleSettings);

    // Auto-save on setting changes
    setupAutoSave();

    // File management
    elements.addFileBtn.addEventListener('click', () => {
        elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', handleFileSelection);

    // Knowledge Base Controls
    if (elements.trainBtn) {
        elements.trainBtn.addEventListener('click', handleTrainKB);
    }
    if (elements.resetKbBtn) {
        elements.resetKbBtn.addEventListener('click', handleResetKB);
    }

    // Keyboard input submit
    if (elements.submitKeyboardBtn) {
        elements.submitKeyboardBtn.addEventListener('click', handleKeyboardSubmit);
    }

    if (elements.keyboardInput) {
        elements.keyboardInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                handleKeyboardSubmit();
            }
        });
    }

    if (elements.systemPromptInput) {
        elements.systemPromptInput.addEventListener('change', (e) => {
            config.systemPrompt = e.target.value;
            window.electronAPI.saveConfig(config);
        });
    }

    if (elements.briefModeCheckbox) {
        elements.briefModeCheckbox.addEventListener('change', (e) => {
            config.briefMode = e.target.checked;
            window.electronAPI.saveConfig(config);
        });
    }

    // Rec button click (manual toggle)
    if (elements.recBtn) {
        elements.recBtn.addEventListener('click', () => {
            window.electronAPI.toggleRecording();
        });
    }

    // Mode button click (cycle modes)
    if (elements.modeBtn) {
        elements.modeBtn.addEventListener('click', () => {
            const modes = Object.keys(INPUT_MODES);
            const currentIndex = modes.indexOf(currentInputMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            handleInputModeChange(modes[nextIndex]);
        });
    }

    // History button click (cycle backwards)
    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('click', () => {
            navigateHistory('up');
        });
    }

    // Legacy mode badge click (for compatibility)
    if (elements.modeBadge) {
        elements.modeBadge.addEventListener('click', () => {
            const modes = Object.keys(INPUT_MODES);
            const currentIndex = modes.indexOf(currentInputMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            handleInputModeChange(modes[nextIndex]);
        });
    }

    // Input field handler (Enter to submit)
    if (elements.inputField) {
        elements.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleInputSubmit();
            }
        });
    }

    // Zoom controls
    if (elements.zoomInBtn) {
        elements.zoomInBtn.addEventListener('click', zoomIn);
    }
    if (elements.zoomOutBtn) {
        elements.zoomOutBtn.addEventListener('click', zoomOut);
    }

    // Keyboard shortcuts for zoom (Restored with safety check)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+' || e.key === 'Add') {
                e.preventDefault();
                zoomIn();
            } else if (e.key === '-' || e.key === 'Subtract') {
                e.preventDefault();
                zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                resetZoom();
            }
        }
    });

    // History Navigation Shortcuts (CTRL + UP/DOWN)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateHistory('up');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateHistory('down');
            }
        }
    });
}




function navigateHistory(direction) {
    const history = config.conversationHistory || [];
    const pairCount = Math.floor(history.length / 2);

    if (pairCount === 0) return;

    // Mapping logic:
    // -1: Live view
    // 0: Oldest pair
    // pairCount - 1: Newest pair

    if (direction === 'up') {
        // Moving back in time (or looping)
        if (historyIndex === -1) {
            historyIndex = pairCount - 1; // Start at newest history
        } else if (historyIndex === 0) {
            historyIndex = pairCount - 1; // Loop to newest
        } else {
            historyIndex--;
        }
    } else if (direction === 'down') {
        // Moving forward in time
        if (historyIndex === -1) {
            historyIndex = 0; // Loop to oldest
        } else if (historyIndex === pairCount - 1) {
            historyIndex = -1; // Back to live
        } else {
            historyIndex++;
        }
    }

    displayHistoryItem();
}

function displayHistoryItem() {
    if (historyIndex === -1) {
        // Show empty/live state - clear if desired, or just leave last live content?
        // Usually "Input" history restores input text, but here we view conversation pairs.
        // Let's clear for "Live" mode to indicate we are ready for new input, 
        // OR restore the last "Live" buffer if we stored it. 
        // For now, let's clear the display to signal "Ready for new input".
        showTranscription('');
        showResponse('');
        updateStatus('Ready (Live)', 'ready');
        if (elements.inputField) elements.inputField.value = '';
    } else {
        const history = config.conversationHistory || [];
        // Index i corresponds to pairs at 2*i and 2*i+1
        const userMsg = history[historyIndex * 2];
        const aiMsg = history[historyIndex * 2 + 1];

        if (userMsg && aiMsg) {
            showTranscription(userMsg.content);
            showResponse(aiMsg.content);
            const clearBtnHtml = ` <span id="clear-history-btn" style="cursor:pointer; text-decoration:underline; margin-left:10px; opacity:0.7; font-size:0.9em;">(Clear)</span>`;
            updateStatus(`History ${historyIndex + 1}/${Math.floor(history.length / 2)}${clearBtnHtml}`, 'ready');
        }
    }
}

function clearHistory() {
    config.conversationHistory = [];
    autoSaveConfig();
    historyIndex = -1;
    displayHistoryItem();
    updateStatus('History Cleared', 'ready');

    // Brief timeout to return to "Ready"
    setTimeout(() => {
        updateStatus('Ready', 'ready');
    }, 2000);
}

function updateHistory(userText, aiResponse) {
    config.conversationHistory = config.conversationHistory || [];

    // Add new pair
    config.conversationHistory.push({ role: 'user', content: userText });
    config.conversationHistory.push({ role: 'assistant', content: aiResponse });

    // Keep only last 3 pairs (6 items)
    if (config.conversationHistory.length > 6) {
        config.conversationHistory = config.conversationHistory.slice(-6);
    }

    // Save
    autoSaveConfig();

    // Reset to live view
    historyIndex = -1;
}


// ==========================================
// Zoom Control
// ==========================================

function zoomIn() {
    setZoomingState();
    window.electronAPI.zoomIn();
    console.log('Zoom in');
}

function zoomOut() {
    setZoomingState();
    window.electronAPI.zoomOut();
    console.log('Zoom out');
}

function resetZoom() {
    setZoomingState();
    window.electronAPI.resetZoom();
    console.log('Zoom reset');
}

function setZoomingState() {
    isZooming = true;
    if (zoomTimeout) clearTimeout(zoomTimeout);

    // Resume auto-resize after a delay when zooming stops
    zoomTimeout = setTimeout(() => {
        isZooming = false;
    }, 1500);
}

function applyZoom() {
    // Zoom is now handled by preload.js via webFrame
    // This function is kept for compatibility with saved config
    if (config.zoom) {
        const factor = config.zoom / 100;
        // Will be applied on init if needed
    }
}

// ==========================================
// Recording Control
// ==========================================

let fullTranscription = '';
let isTranscribing = false;
let transcriptionInterval = null;

async function handleRecordingToggle(recording) {
    isRecording = recording;

    if (isRecording) {
        startRecording();
    } else {
        stopRecording();
    }

    updateRecordingUI();
}

async function startRecording() {
    // Skip if in keyboard mode
    if (currentInputMode === 'keyboard') {
        return;
    }

    try {
        // Get device ID from config
        const deviceId = config.inputDeviceId !== 'default' ? config.inputDeviceId : undefined;

        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true,
                sampleRate: 16000
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const audioTracks = stream.getAudioTracks();

        if (audioTracks.length === 0) {
            throw new Error('No audio input device found');
        }

        console.log('Using audio device:', audioTracks[0].label);

        // Reset state
        fullTranscription = '';
        audioChunks = [];
        showTranscription('🎙️ Listening...');

        // Setup MediaRecorder
        const audioStream = new MediaStream(audioTracks);
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: 'audio/webm;codecs=opus'
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // Clear interval
            if (transcriptionInterval) {
                clearInterval(transcriptionInterval);
                transcriptionInterval = null;
            }
            await finalizeRecording();
        };

        // Start recording - collect data every second for smooth processing
        mediaRecorder.start(1000);

        // Transcribe every 5 seconds while recording
        transcriptionInterval = setInterval(async () => {
            if (isRecording && audioChunks.length > 0 && !isTranscribing) {
                await transcribeCurrentAudio();
            }
        }, 5000);

        updateStatus('🎙️ Recording...', 'recording');

    } catch (error) {
        console.error('Failed to start recording:', error);
        updateStatus('Error: ' + error.message, 'error');
        isRecording = false;
        updateRecordingUI();
    }
}

async function transcribeCurrentAudio() {
    if (audioChunks.length === 0) return;

    isTranscribing = true;
    updateStatus('🎙️ Transcribing...', 'recording');

    try {
        // Combine all chunks collected so far
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = new Uint8Array(arrayBuffer);

        const result = await window.electronAPI.transcribeAudio(Array.from(audioBuffer));

        if (result.text && !result.error) {
            fullTranscription = result.text;
            showTranscription(fullTranscription + ' ▌');
        } else if (result.error) {
            console.error('Transcription error:', result.error);
        }

        updateStatus('🎙️ Recording...', 'recording');
    } catch (error) {
        console.error('Transcription error:', error);
    } finally {
        isTranscribing = false;
    }
}

function stopRecording() {
    // Clear transcription interval
    if (transcriptionInterval) {
        clearInterval(transcriptionInterval);
        transcriptionInterval = null;
    }

    // Stop MediaRecorder
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    updateStatus('Processing...', 'processing');
}

async function finalizeRecording() {
    if (audioChunks.length === 0) {
        updateStatus('No audio recorded', 'error');
        return;
    }

    try {
        updateStatus('Finalizing transcription...', 'processing');

        // Final transcription of all audio
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = new Uint8Array(arrayBuffer);

        const transcriptionResult = await window.electronAPI.transcribeAudio(Array.from(audioBuffer));

        if (transcriptionResult.error) {
            showTranscription(`Error: ${transcriptionResult.error}`);
            updateStatus('Transcription failed', 'error');
            return;
        }

        fullTranscription = transcriptionResult.text;
        showTranscription(fullTranscription);

        // Get AI response
        showResponse(''); // Clear previous response so it doesn't persist while loading
        updateStatus('Getting AI response...', 'processing');

        const aiResult = await window.electronAPI.getAIResponse(fullTranscription);

        if (aiResult.error) {
            showResponse(`Error: ${aiResult.error}`);
            updateStatus('AI response failed', 'error');
            return;
        }

        showResponse(aiResult.response);
        updateStatus('Ready', 'ready');

        // Update History
        updateHistory(fullTranscription, aiResult.response);


    } catch (error) {
        console.error('Processing error:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}

// Keep for compatibility
async function processRecording() {
    await finalizeRecording();
}

// ==========================================
// UI Updates
// ==========================================

function updateRecordingUI() {
    if (isRecording) {
        // Recording active
        if (elements.recBtn) elements.recBtn.classList.add('recording');
        if (elements.contentArea) elements.contentArea.classList.remove('hidden');
        if (elements.statusBar) elements.statusBar.classList.add('recording');
    } else {
        // Recording stopped
        if (elements.recBtn) elements.recBtn.classList.remove('recording');
        if (elements.statusBar) elements.statusBar.classList.remove('recording');
    }
}

function updateStatus(text, type = 'ready') {
    // Override "Ready" state if Knowledge Base is active
    if (type === 'ready' && config.vectorStoreId) {
        text = 'Ready / Knowledge Base';
        type = 'knowledge';
    }

    if (elements.statusText) {
        elements.statusText.innerHTML = text; // Allow HTML for button

        // Re-attach listener if clear button exists
        const clearBtn = document.getElementById('clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearHistory();
            });
        }
    }

    // Show content area when there's activity
    if (type !== 'ready' && elements.contentArea) {
        elements.contentArea.classList.remove('hidden');
    }

    const colors = {
        ready: 'var(--success)',
        recording: 'var(--error)',
        processing: 'var(--warning)',
        error: 'var(--error)',
        knowledge: '#8b5cf6' // Purple for Knowledge Base
    };

    if (elements.statusDot) {
        elements.statusDot.style.background = colors[type] || colors.ready;
    }

    if (elements.statusBar) {
        elements.statusBar.classList.remove('recording', 'processing');
        // We don't need a specific class for knowledge, just the color update above
        if (type === 'recording') elements.statusBar.classList.add('recording');
        if (type === 'processing') elements.statusBar.classList.add('processing');
    }
}

function showTranscription(text) {
    // Show section when there's content
    if (text && text.trim()) {
        if (elements.contentArea) elements.contentArea.classList.remove('hidden');
        if (elements.transcriptionSection) elements.transcriptionSection.classList.remove('hidden');
        if (elements.transcriptionContent) elements.transcriptionContent.innerHTML = escapeHtml(text);
    } else {
        if (elements.transcriptionSection) elements.transcriptionSection.classList.add('hidden');
    }
}

function showResponse(text) {
    // Show section when there's content
    if (text && text.trim()) {
        if (elements.contentArea) elements.contentArea.classList.remove('hidden');
        if (elements.responseSection) elements.responseSection.classList.remove('hidden');
        const formattedText = formatResponse(text);
        if (elements.responseContent) elements.responseContent.innerHTML = formattedText;
    } else {
        if (elements.responseSection) elements.responseSection.classList.add('hidden');
    }
}

function formatResponse(text) {
    // Basic markdown-like formatting
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// Settings Management
// ==========================================

function applyConfigToUI() {
    elements.apiKeyInput.value = config.apiKey || '';
    elements.modelSelect.value = config.model || 'gpt-4o-mini';
    if (elements.languageSelect) {
        elements.languageSelect.value = config.language || 'en';
    }
    elements.systemPromptInput.value = config.systemPrompt || '';
    if (elements.briefModeCheckbox) {
        elements.briefModeCheckbox.checked = config.briefMode || false;
    }

    updateFileList();
}

function updateFileList() {
    const files = config.knowledgeBasePaths || [];

    if (files.length === 0) {
        elements.fileList.innerHTML = '<p class="placeholder">No files added</p>';
        return;
    }

    elements.fileList.innerHTML = files.map((filePath, index) => {
        const fileName = filePath.split('/').pop().split('\\').pop();
        return `
      <div class="file-item">
        <span class="file-name" title="${escapeHtml(filePath)}">📄 ${escapeHtml(fileName)}</span>
        <button class="remove-btn" data-index="${index}" title="Remove">✕</button>
      </div>
    `;
    }).join('');

    // Add remove handlers
    elements.fileList.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            config.knowledgeBasePaths.splice(index, 1);
            updateFileList();
            window.electronAPI.saveConfig(config); // Sync to main process
        });
    });
}

function handleFileSelection(event) {
    const files = Array.from(event.target.files);

    if (!config.knowledgeBasePaths) {
        config.knowledgeBasePaths = [];
    }

    files.forEach(file => {
        // Use the file path if available (Electron provides this)
        const filePath = file.path || file.name;
        if (!config.knowledgeBasePaths.includes(filePath)) {
            config.knowledgeBasePaths.push(filePath);
        }
    });

    updateFileList();
    window.electronAPI.saveConfig(config); // Sync to main process
    event.target.value = ''; // Reset input
}

async function handleTrainKB() {
    if (elements.kbStatus) elements.kbStatus.innerText = '⏳ Initializing Assistant & Indexing... This may take a moment.';

    // Disable buttons
    elements.trainBtn.disabled = true;

    try {
        const result = await window.electronAPI.createKnowledgeBase();

        if (result.success) {
            // RELOAD CONFIG to get the new assistantId/vectorStoreId
            config = await window.electronAPI.getConfig();

            if (elements.kbStatus) elements.kbStatus.innerText = `✅ Success! Indexed ${result.count} files.`;
            // Flash success color
            setTimeout(() => { if (elements.kbStatus) elements.kbStatus.innerText = 'Ready. Knowledge Base Active.'; }, 5000);
        } else {
            if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${result.error}`;
        }
    } catch (e) {
        if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${e.message}`;
    } finally {
        elements.trainBtn.disabled = false;
    }
}

async function handleResetKB() {
    if (!confirm('Are you sure you want to delete the Knowledge Base? This will delete the Vector Store from OpenAI.')) return;

    if (elements.kbStatus) elements.kbStatus.innerText = '⏳ Resetting...';

    try {
        const result = await window.electronAPI.resetKnowledgeBase();

        if (result.success) {
            config = await window.electronAPI.getConfig(); // Sync state
            if (elements.kbStatus) elements.kbStatus.innerText = '✅ Knowledge Base Cleared.';
        } else {
            if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${result.error}`;
        }
    } catch (e) {
        if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${e.message}`;
    }
}

// ==========================================
// Settings UI Toggle
// ==========================================

function toggleSettings() {
    const isVisible = elements.settingsPanel.classList.toggle('visible');
    elements.settingsBtn.classList.toggle('active', isVisible);

    // Get UI elements
    const toolbarLeft = document.querySelector('.toolbar-left');
    const toolbarRight = document.querySelector('.toolbar-right');
    const inputField = document.getElementById('input-field');
    const settingsModeTitle = document.getElementById('settings-mode-title');
    const contentArea = elements.contentArea;

    if (isVisible) {
        // Settings open: hide all icons except gear, show settings title
        if (toolbarLeft) toolbarLeft.classList.add('hidden');
        if (inputField) inputField.classList.add('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.remove('hidden');
        if (contentArea) contentArea.classList.add('hidden');

        // Hide other toolbar buttons (keep only settings and drag)
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn:not(#settings-btn):not(#close-btn):not(#drag-btn)');
        otherButtons?.forEach(btn => btn.classList.add('hidden'));
    } else {
        // Settings closed: restore everything
        if (toolbarLeft) toolbarLeft.classList.remove('hidden');
        if (inputField) inputField.classList.remove('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.add('hidden');

        // Show toolbar buttons
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn');
        otherButtons?.forEach(btn => btn.classList.remove('hidden'));
    }
}

// ==========================================
// Auto-save Settings
// ==========================================

let saveTimeout = null;

function setupAutoSave() {
    // Add change listeners to all settings inputs
    const inputs = [
        elements.apiKeyInput,
        elements.modelSelect,
        elements.languageSelect,
        elements.systemPromptInput,
        elements.inputDeviceSelect,
        elements.outputDeviceSelect
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', autoSaveConfig);
            input.addEventListener('input', debounceAutoSave);
        }
    });
}

function debounceAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSaveConfig, 500);
}

async function autoSaveConfig() {
    if (saveTimeout) clearTimeout(saveTimeout);

    config.apiKey = elements.apiKeyInput?.value?.trim() || '';
    config.model = elements.modelSelect?.value || 'gpt-4o-mini';
    config.language = elements.languageSelect?.value || 'en';
    config.systemPrompt = elements.systemPromptInput?.value?.trim() || '';
    config.inputDeviceId = elements.inputDeviceSelect?.value || 'default';
    config.outputDeviceId = elements.outputDeviceSelect?.value || 'default';
    config.inputDeviceId = elements.inputDeviceSelect?.value || 'default';
    config.outputDeviceId = elements.outputDeviceSelect?.value || 'default';
    config.inputMode = currentInputMode;
    // conversationHistory is already in config, preserved automatically


    try {
        await window.electronAPI.saveConfig(config);
        console.log('Settings auto-saved');
    } catch (error) {
        console.error('Failed to auto-save settings:', error);
    }
}

// ==========================================
// Input Mode Handling
// ==========================================

async function handleInputSubmit() {
    const text = elements.inputField?.value?.trim();
    if (!text) return;

    // Clear input
    elements.inputField.value = '';

    // Show the question as transcription
    showTranscription(text);

    // Get AI response
    showResponse(''); // Clear previous response
    updateStatus('Getting AI response...', 'processing');

    try {
        const aiResult = await window.electronAPI.getAIResponse(text);

        if (aiResult.error) {
            showResponse(`Error: ${aiResult.error}`);
            updateStatus('AI response failed', 'error');
            return;
        }

        showResponse(aiResult.response);
        updateStatus('Ready', 'ready');

        // Update History
        updateHistory(text, aiResult.response);

    } catch (error) {
        console.error('Input submit error:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}

function handleInputModeChange(mode) {
    currentInputMode = mode;
    config.inputMode = mode;
    updateInputModeUI();

    // Show brief notification
    updateStatus(`Mode: ${INPUT_MODES[mode].text}`, 'ready');
}

function updateInputModeUI() {
    const modeConfig = INPUT_MODES[currentInputMode];

    if (elements.modeIcon) {
        elements.modeIcon.innerHTML = modeConfig.icon;
    }
    if (elements.modeBtn) {
        elements.modeBtn.title = `CTRL + M: ${modeConfig.text}`;
    }
    if (elements.modeBadge) {
        elements.modeBadge.style.borderColor = modeConfig.color;
    }

    // Show/hide keyboard input section
    if (currentInputMode === 'keyboard') {
        elements.keyboardInputSection?.classList.remove('hidden');
        elements.recordingSection?.classList.add('hidden');
    } else {
        elements.keyboardInputSection?.classList.add('hidden');
        elements.recordingSection?.classList.remove('hidden');
    }
}

// ==========================================
// Device Enumeration
// ==========================================

async function populateDevices() {
    try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });

        const devices = await navigator.mediaDevices.enumerateDevices();

        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

        // Populate input devices
        if (elements.inputDeviceSelect) {
            elements.inputDeviceSelect.innerHTML = '<option value="default">Default</option>';
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
                elements.inputDeviceSelect.appendChild(option);
            });

            if (config.inputDeviceId) {
                elements.inputDeviceSelect.value = config.inputDeviceId;
            }
        }

        // Populate output devices
        if (elements.outputDeviceSelect) {
            elements.outputDeviceSelect.innerHTML = '<option value="default">Default</option>';
            audioOutputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Speaker ${device.deviceId.slice(0, 8)}`;
                elements.outputDeviceSelect.appendChild(option);
            });

            if (config.outputDeviceId) {
                elements.outputDeviceSelect.value = config.outputDeviceId;
            }
        }

    } catch (error) {
        console.error('Failed to enumerate devices:', error);
    }
}

// ==========================================
// Keyboard Input Handling
// ==========================================

async function handleKeyboardSubmit() {
    const text = elements.keyboardInput?.value?.trim();

    if (!text) {
        updateStatus('Please enter some text', 'error');
        return;
    }

    try {
        updateStatus('Getting AI response...', 'processing');

        // Show the typed text as transcription
        showTranscription(text);

        // Get AI response directly (skip transcription)
        const aiResult = await window.electronAPI.getAIResponse(text);

        if (aiResult.error) {
            showResponse(`Error: ${aiResult.error}`);
            updateStatus('AI response failed', 'error');
            return;
        }

        showResponse(aiResult.response);
        updateStatus('Ready', 'ready');

        // Update History
        updateHistory(text, aiResult.response);


        // Clear input
        if (elements.keyboardInput) {
            elements.keyboardInput.value = '';
        }

    } catch (error) {
        console.error('Keyboard submit error:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}

// ==========================================
// Start Application
// ==========================================

document.addEventListener('DOMContentLoaded', init);
