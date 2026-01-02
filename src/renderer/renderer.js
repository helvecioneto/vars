// ==========================================
// VARS - Renderer Process
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

// Realtime audio streaming
let realtimeActive = false;
let audioContext = null;
let scriptProcessor = null;


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
    statusModel: document.getElementById('status-model'),

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
    googleApiKeyInput: document.getElementById('google-api-key'),
    providerSelect: document.getElementById('provider-select'),
    modelSelect: document.getElementById('model-select'),
    languageSelect: document.getElementById('language-select'),
    systemPromptInput: document.getElementById('system-prompt'),
    fileList: document.getElementById('file-list'),
    inputDeviceSelect: document.getElementById('input-device'),
    systemAudioDeviceSelect: document.getElementById('system-audio-device'),
    refreshAudioBtn: document.getElementById('refresh-audio-btn'),
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

    // Populate provider and model options from config
    await populateProviderOptions();
    await populateModelOptions();

    applyConfigToUI();
    updateInputModeUI();
    updateModelDisplay();
    await populateDevices();
    await populateSystemAudioDevices();

    // Update button tooltips based on OS
    updateButtonTooltips();

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

    console.log('VARS initialized');

    // Check for first-time user and start onboarding
    checkFirstRunOnboarding();
}

/**
 * Updates button tooltips with OS-appropriate keyboard shortcuts
 * Uses native title attribute for browser tooltips
 * macOS uses ⌥ (Option) for shortcuts
 * Windows/Linux uses Ctrl for shortcuts
 */
function updateButtonTooltips() {
    const isMac = window.electronAPI.platform === 'darwin';
    // Shortcuts: macOS uses Option (⌥), others use Ctrl
    const mod = isMac ? '⌥' : 'Ctrl';

    // Record button (global shortcut)
    if (elements.recBtn) {
        elements.recBtn.title = `${mod}+Space: Record`;
    }

    // Mode switch button (handled by updateInputModeUI for dynamic text)

    // History button (uses same modifier as other shortcuts)
    if (elements.historyBtn) {
        elements.historyBtn.title = `${mod}+↑/↓: History`;
    }

    // Settings button
    if (elements.settingsBtn) {
        elements.settingsBtn.title = 'Settings';
    }

    // Drag button
    if (elements.dragBtn) {
        elements.dragBtn.title = 'Move / Right-click: Menu';
    }

    // Knowledge Base buttons (in settings)
    const addFileBtn = document.getElementById('add-file-btn');
    if (addFileBtn) addFileBtn.title = 'Add Files';

    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) trainBtn.title = 'Train KB';

    const resetKbBtn = document.getElementById('reset-kb-btn');
    if (resetKbBtn) resetKbBtn.title = 'Clear KB';
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

    // Settings tabs navigation
    setupSettingsTabs();

    // API Key help link
    const apiKeyHelp = document.getElementById('api-key-help');
    if (apiKeyHelp) {
        apiKeyHelp.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening OpenAI API Key page...');
            window.electronAPI.openExternal('https://platform.openai.com/api-keys');
        });
    }

    // Google API Key help link
    const googleApiKeyHelp = document.getElementById('google-api-key-help');
    if (googleApiKeyHelp) {
        googleApiKeyHelp.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening Google AI Studio page...');
            window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
        });
    }

    // GitHub link in footer
    const githubLink = document.getElementById('github-link');
    if (githubLink) {
        githubLink.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening GitHub profile...');
            window.electronAPI.openExternal('https://github.com/helvecioneto/');
        });
    }

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

    // API Key Test Buttons (OpenAI and Google)
    const testApiBtn = document.getElementById('test-api-btn');
    if (testApiBtn) {
        testApiBtn.addEventListener('click', testAPIKey);
    }
    const testGoogleApiBtn = document.getElementById('test-google-api-btn');
    if (testGoogleApiBtn) {
        testGoogleApiBtn.addEventListener('click', testAPIKey);
    }

    // Keyboard input submit
    if (elements.submitKeyboardBtn) {
        elements.submitKeyboardBtn.addEventListener('click', handleKeyboardSubmit);
    }

    if (elements.keyboardInput) {
        elements.keyboardInput.addEventListener('keydown', (e) => {
            const isMac = window.electronAPI.platform === 'darwin';
            const modifierKey = isMac ? e.altKey : e.ctrlKey;

            if (e.key === 'Enter' && modifierKey) {
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
        const isMac = window.electronAPI.platform === 'darwin';
        // macOS: Option, Others: Ctrl/Meta
        const modifierKey = isMac ? e.altKey : (e.ctrlKey || e.metaKey);

        if (modifierKey) {
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

    // History Navigation Shortcuts
    document.addEventListener('keydown', (e) => {
        const isMac = window.electronAPI.platform === 'darwin';
        const modifierKey = isMac ? e.altKey : e.ctrlKey;

        if (modifierKey) {
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
let isFinalizing = false; // Flag to prevent intermediate transcriptions during finalization
let transcriptionInterval = null;

/**
 * Capture system audio using PulseAudio/PipeWire monitor devices (Linux)
 * or desktopCapturer (Windows/macOS)
 * @param {number} sampleRate - The desired sample rate
 * @returns {Promise<MediaStream|null>} The captured audio stream
 */
async function captureSystemAudio(sampleRate) {
    const platform = window.electronAPI.platform;

    // On Linux, use monitor devices directly
    if (platform === 'linux') {
        return await captureLinuxSystemAudio(sampleRate);
    }

    // On Windows/macOS, use desktopCapturer
    return await captureDesktopAudio(sampleRate);
}

/**
 * Capture system audio on Linux using PulseAudio/PipeWire monitor devices
 * Audio is captured in Main Process, we just start/stop and fetch data
 * Returns a mock stream object with the necessary interface
 */
async function captureLinuxSystemAudio(sampleRate) {
    const deviceName = config.systemAudioDeviceId;

    if (!deviceName) {
        throw new Error('No audio device configured.\n\nPlease go to Settings > Audio and:\n1. Click the refresh button\n2. Select a device from "System Audio (Monitors)"');
    }

    try {
        // Start capture in Main Process - audio is stored there
        const result = await window.electronAPI.systemAudio.startCapture(deviceName, sampleRate);

        if (result.error) {
            throw new Error(result.error);
        }

        // Create a mock MediaStream-like object
        const mockStream = {
            _isLinuxSystemAudio: true,
            _sampleRate: sampleRate,
            _deviceName: deviceName,
            getAudioTracks: () => [{
                label: 'Linux System Audio (' + deviceName.split('.')[0] + ')',
                stop: () => { },
                getSettings: () => ({ sampleRate: sampleRate, channelCount: 1 })
            }],
            getVideoTracks: () => [],
            getTracks: () => mockStream.getAudioTracks(),
            _cleanup: async () => {
                await window.electronAPI.systemAudio.stopCapture();
            }
        };

        return mockStream;

    } catch (error) {
        console.error('[SystemAudio] Capture failed:', error);
        throw error;
    }
}

/**
 * Capture desktop audio on Windows/macOS using desktopCapturer
 */
async function captureDesktopAudio(sampleRate) {
    try {
        // Check if a screen source is configured
        const configuredSource = config.systemAudioDeviceId;

        const sources = await window.electronAPI.getDesktopSources();

        if (!sources || sources.length === 0) {
            throw new Error('No capture sources available');
        }

        // Find the configured source or use the first screen source
        let screenSource;
        if (configuredSource) {
            screenSource = sources.find(s => s.id === configuredSource);
        }
        if (!screenSource) {
            screenSource = sources.find(s => s.id.startsWith('screen:'));
        }

        if (!screenSource) {
            throw new Error('No screen source available.\n\nPlease go to Settings > Audio and select a screen source.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id,
                    maxWidth: 1,
                    maxHeight: 1,
                    maxFrameRate: 1
                }
            }
        });

        // Stop video tracks
        stream.getVideoTracks().forEach(track => {
            track.stop();
            stream.removeTrack(track);
        });

        if (stream.getAudioTracks().length === 0) {
            throw new Error('No audio captured');
        }

        return stream;

    } catch (error) {
        console.error('[SystemAudio] Desktop capture failed:', error);
        throw error;
    }
}

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
        const provider = config.provider || 'openai';
        const sampleRate = provider === 'google' ? 16000 : 24000;
        let stream;
        let audioTracks;

        // Check if this is Linux system audio (special handling required)
        const isLinuxSystemAudio = currentInputMode === 'system' && window.electronAPI.platform === 'linux';

        if (currentInputMode === 'system') {
            // Capture system/computer audio
            stream = await captureSystemAudio(sampleRate);

            if (!stream) {
                throw new Error('Failed to capture system audio.');
            }

            audioTracks = stream.getAudioTracks();

            // Stop video tracks if any (we only need audio)
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach(track => track.stop());

            if (audioTracks.length === 0 && !stream._isLinuxSystemAudio) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('No audio captured. Make sure to enable "Share audio" when selecting the screen/window.');
            }

            console.log('Capturing system audio:', audioTracks[0]?.label || 'Linux PulseAudio');
        } else {
            // Capture microphone audio using getUserMedia
            const deviceId = config.inputDeviceId !== 'default' ? config.inputDeviceId : undefined;
            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                    sampleRate: sampleRate
                }
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            audioTracks = stream.getAudioTracks();

            if (audioTracks.length === 0) {
                throw new Error('No audio input device found');
            }

            console.log('Using microphone:', audioTracks[0].label);
        }

        // Reset state
        fullTranscription = '';
        audioChunks = [];
        isTranscribing = false;
        isFinalizing = false;
        showTranscription(currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Listening...');

        // Handle Linux system audio differently (no MediaRecorder)
        if (stream._isLinuxSystemAudio) {
            // Store the stream for cleanup and data access
            window._linuxSystemAudioStream = stream;

            // For Linux system audio, we'll transcribe the PCM data directly
            // Set up periodic transcription
            transcriptionInterval = setInterval(async () => {
                if (isRecording && !isTranscribing) {
                    await transcribeLinuxSystemAudio();
                }
            }, 3000);

            const statusMsg = '🔊 Capturing system audio...';
            updateStatus(statusMsg, 'recording');
            return;
        }

        // Setup MediaRecorder for regular audio (microphone or Windows/macOS system audio)
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
            if (transcriptionInterval) {
                clearInterval(transcriptionInterval);
                transcriptionInterval = null;
            }
            await finalizeRecording();
        };

        mediaRecorder.start(1000);

        // Batch transcription mode (every 2 seconds)
        transcriptionInterval = setInterval(async () => {
            if (isRecording && audioChunks.length > 0 && !isTranscribing) {
                await transcribeCurrentAudio();
            }
        }, 2000);

        const statusMsg = currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Recording...';
        updateStatus(statusMsg, 'recording');

    } catch (error) {
        console.error('Failed to start recording:', error);
        updateStatus('Error: ' + error.message, 'error');
        isRecording = false;
        updateRecordingUI();
    }
}

/**
 * Transcribe Linux system audio - fetches WAV data from Main Process
 */
async function transcribeLinuxSystemAudio() {
    // Skip if finalizing - let finalizeLinuxSystemAudio handle it
    if (isFinalizing) {
        return;
    }

    // Check if capture is active
    const capturingResult = await window.electronAPI.systemAudio.isCapturing();
    if (!capturingResult.capturing) {
        return;
    }

    // Check buffer size first
    const sizeResult = await window.electronAPI.systemAudio.getBufferSize();
    if (!sizeResult.size || sizeResult.size < 3200) { // At least 0.1 seconds
        return;
    }

    isTranscribing = true;
    updateStatus('🔊 Transcribing system audio...', 'recording');

    try {
        // Get WAV audio data from Main Process
        const audioResult = await window.electronAPI.systemAudio.getAudio();

        if (!audioResult.audio || audioResult.audio.length === 0) {
            isTranscribing = false;
            return;
        }

        // Send to transcription API
        const result = await window.electronAPI.transcribeAudio(audioResult.audio);

        if (result.text && !result.error) {
            fullTranscription = result.text;
            showTranscription(fullTranscription + ' ▌');
        } else if (result.error) {
            console.error('Transcription error:', result.error);
        }

        updateStatus('🔊 Capturing system audio...', 'recording');
    } catch (error) {
        console.error('[SystemAudio] Transcription failed:', error);
    } finally {
        isTranscribing = false;
    }
}

async function transcribeCurrentAudio() {
    if (audioChunks.length === 0) return;

    isTranscribing = true;
    const transcribingMsg = currentInputMode === 'system' ? '🔊 Transcribing system audio...' : '🎙️ Transcribing...';
    updateStatus(transcribingMsg, 'recording');

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

        const statusMsg = currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Recording...';
        updateStatus(statusMsg, 'recording');
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

    // Stop realtime streaming
    if (realtimeActive) {
        realtimeActive = false;
        window.electronAPI.realtimeStop();
    }

    // Clear realtime send interval
    if (window._realtimeSendInterval) {
        clearInterval(window._realtimeSendInterval);
        window._realtimeSendInterval = null;
    }

    // Cleanup Linux system audio
    if (window._linuxSystemAudioStream) {
        const stream = window._linuxSystemAudioStream;
        window._linuxSystemAudioStream = null;

        // Do final transcription FIRST (before stopping capture)
        // This ensures all audio is collected before parec is killed
        finalizeLinuxSystemAudio();
        return; // Skip the rest, finalizeLinuxSystemAudio handles cleanup
    }

    // Cleanup AudioContext
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    // Stop MediaRecorder and cleanup stream
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        const stream = mediaRecorder.stream;

        // Call cleanup function if this is a Linux system audio stream
        if (stream._cleanup) {
            stream._cleanup();
        }

        stream.getTracks().forEach(track => track.stop());
    }

    updateStatus('Processing...', 'processing');
}

/**
 * Finalize Linux system audio recording
 */
async function finalizeLinuxSystemAudio() {
    updateStatus('Processing final audio...', 'processing');

    // Set finalizing flag to prevent intermediate transcriptions
    isFinalizing = true;

    // Wait for any ongoing transcription to finish
    let waitCount = 0;
    while (isTranscribing && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
    }

    try {
        // Small delay to ensure last audio chunks are in the buffer
        await new Promise(resolve => setTimeout(resolve, 150));

        // Get ALL audio from buffer and clear it (final transcription)
        const audioResult = await window.electronAPI.systemAudio.getAudioFinal();

        // Now stop capture AFTER getting all audio
        await window.electronAPI.systemAudio.stopCapture();

        if (audioResult.audio && audioResult.audio.length > 0) {
            // Transcribe final audio (this is the complete audio)
            const result = await window.electronAPI.transcribeAudio(audioResult.audio);

            if (result.text && !result.error) {
                fullTranscription = result.text;
            } else if (result.error) {
                console.error('[SystemAudio] Transcription error:', result.error);
            }
        }

    } catch (error) {
        console.error('[SystemAudio] Error getting final audio:', error);
        // Ensure capture is stopped even on error
        await window.electronAPI.systemAudio.stopCapture();
    } finally {
        isTranscribing = false;
        isFinalizing = false;
    }

    // Show transcription result
    if (fullTranscription) {
        showTranscription(fullTranscription);

        // Get AI response if we have transcription
        showResponse(''); // Clear previous response
        updateStatus('Getting AI response...', 'processing');
        try {
            const aiResult = await window.electronAPI.getAIResponse(fullTranscription);

            if (aiResult.error) {
                showResponse(`Error: ${aiResult.error}`);
                updateStatus('AI response failed', 'error');
                return;
            }

            showResponse(aiResult.response);
            updateStatus('Done', 'idle');

            // Update History
            updateHistory(fullTranscription, aiResult.response);
        } catch (error) {
            console.error('AI response error:', error);
            updateStatus('Error', 'error');
        }
    } else {
        updateStatus('No audio captured', 'error');
    }
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
    // Google API Key
    if (elements.googleApiKeyInput) {
        elements.googleApiKeyInput.value = config.googleApiKey || '';
    }
    // Set provider and tier
    if (elements.providerSelect) {
        elements.providerSelect.value = config.provider || 'openai';
    }
    // Tier is now managed by tier buttons (populated in populateModelOptions)
    if (elements.languageSelect) {
        elements.languageSelect.value = config.language || 'en';
    }
    elements.systemPromptInput.value = config.systemPrompt || '';
    if (elements.briefModeCheckbox) {
        elements.briefModeCheckbox.checked = config.briefMode || false;
    }

    // Update API Key visibility based on provider
    updateAPIKeyVisibility();

    updateFileList();
    updateModelDisplay();
}

/**
 * Updates the visibility of API Key input fields based on the selected provider.
 * Shows only the relevant API Key field (OpenAI or Google).
 */
function updateAPIKeyVisibility() {
    const provider = elements.providerSelect?.value || 'openai';
    const openaiKeyGroup = document.getElementById('openai-key-group');
    const googleKeyGroup = document.getElementById('google-key-group');

    if (openaiKeyGroup && googleKeyGroup) {
        if (provider === 'google') {
            openaiKeyGroup.classList.add('hidden');
            googleKeyGroup.classList.remove('hidden');
        } else {
            openaiKeyGroup.classList.remove('hidden');
            googleKeyGroup.classList.add('hidden');
        }
    }
}

/**
 * Tests the API Key connectivity for the current provider.
 * Shows visual feedback for success/failure.
 */
async function testAPIKey() {
    const testStatus = document.getElementById('api-test-status');
    const provider = elements.providerSelect?.value || 'openai';

    // Get the correct test button based on provider
    const testBtn = provider === 'google'
        ? document.getElementById('test-google-api-btn')
        : document.getElementById('test-api-btn');

    if (!testStatus) return;

    const apiKey = provider === 'google'
        ? elements.googleApiKeyInput?.value?.trim()
        : elements.apiKeyInput?.value?.trim();

    if (!apiKey) {
        testStatus.textContent = 'Please enter an API key first';
        testStatus.className = 'api-test-status error';
        return;
    }

    // Show loading state
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.classList.add('testing');
    }
    testStatus.textContent = 'Testing...';
    testStatus.className = 'api-test-status testing';

    // Get selected tier
    const activeTierBtn = document.querySelector('.tier-btn.active');
    const tier = activeTierBtn?.dataset?.tier || 'balanced';

    try {
        const result = await window.electronAPI.testAPIKey(provider, apiKey, tier);

        if (result.success) {
            testStatus.textContent = '✓ Connection successful';
            testStatus.className = 'api-test-status success';
            if (testBtn) testBtn.classList.add('success');
        } else {
            testStatus.textContent = result.error || 'Connection failed';
            testStatus.className = 'api-test-status error';
        }
    } catch (error) {
        testStatus.textContent = 'Test failed: ' + error.message;
        testStatus.className = 'api-test-status error';
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
        }

        // Clear status after 5 seconds
        setTimeout(() => {
            testStatus.textContent = '';
            testStatus.className = 'api-test-status';
            if (testBtn) testBtn.classList.remove('success');
        }, 5000);
    }
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
// Settings Tabs Navigation
// ==========================================

function setupSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const tabContents = document.querySelectorAll('.settings-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const targetContent = document.getElementById(`tab-${targetTab}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// ==========================================
// Auto-save Settings
// ==========================================

let saveTimeout = null;

function setupAutoSave() {
    // Add change listeners to all settings inputs
    const inputs = [
        elements.apiKeyInput,
        elements.googleApiKeyInput,
        elements.providerSelect,
        elements.languageSelect,
        elements.systemPromptInput,
        elements.inputDeviceSelect
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', autoSaveConfig);
            input.addEventListener('input', debounceAutoSave);
        }
    });

    // Add specific listener for provider change to update API Key visibility
    if (elements.providerSelect) {
        elements.providerSelect.addEventListener('change', () => {
            updateAPIKeyVisibility();
            // Refresh tier buttons to update "Fast (Free)" label based on provider
            populateModelOptions();
        });
    }

    // System audio device selection
    if (elements.systemAudioDeviceSelect) {
        elements.systemAudioDeviceSelect.addEventListener('change', async (e) => {
            config.systemAudioDeviceId = e.target.value;
            await autoSaveConfig();
            console.log('[Settings] System audio device saved:', e.target.value.slice(0, 20) + '...');
        });
    }

    // Refresh audio devices button
    if (elements.refreshAudioBtn) {
        elements.refreshAudioBtn.addEventListener('click', async () => {
            await populateSystemAudioDevices();
        });
    }

}

function debounceAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSaveConfig, 500);
}

async function autoSaveConfig() {
    if (saveTimeout) clearTimeout(saveTimeout);

    config.apiKey = elements.apiKeyInput?.value?.trim() || '';
    config.googleApiKey = elements.googleApiKeyInput?.value?.trim() || '';
    // Save provider and tier
    config.provider = elements.providerSelect?.value || 'openai';
    // Tier is managed by tier buttons
    const activeTierBtn = document.querySelector('.tier-btn.active');
    config.tier = activeTierBtn?.dataset?.tier || config.tier || 'balanced';
    config.language = elements.languageSelect?.value || 'en';
    config.systemPrompt = elements.systemPromptInput?.value?.trim() || '';
    config.inputDeviceId = elements.inputDeviceSelect?.value || 'default';
    config.systemAudioDeviceId = elements.systemAudioDeviceSelect?.value || '';
    config.inputMode = currentInputMode;
    config.briefMode = elements.briefModeCheckbox?.checked || false;
    // conversationHistory is already in config, preserved automatically


    try {
        await window.electronAPI.saveConfig(config);
        updateModelDisplay();
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
    const isMac = window.electronAPI.platform === 'darwin';
    // Global shortcuts: macOS uses Option (⌥), others use Ctrl
    const globalMod = isMac ? '⌥' : 'Ctrl';

    if (elements.modeIcon) {
        elements.modeIcon.innerHTML = modeConfig.icon;
    }
    if (elements.modeBtn) {
        elements.modeBtn.title = `${globalMod}+M: ${modeConfig.text}`;
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
        // Note: Modern browsers allow enumerateDevices() without prior getUserMedia
        // Permission will be requested when actually starting recording
        const devices = await navigator.mediaDevices.enumerateDevices();

        const audioInputs = devices.filter(d => d.kind === 'audioinput');

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

    } catch (error) {
        console.error('Failed to enumerate devices:', error);
    }
}

// ==========================================
// System Audio Device Enumeration
// ==========================================

async function populateSystemAudioDevices() {
    if (!elements.systemAudioDeviceSelect) return;

    elements.systemAudioDeviceSelect.innerHTML = '<option value="">Loading...</option>';

    const platform = window.electronAPI.platform;

    try {
        let devices = [];

        if (platform === 'linux') {
            // Linux: Use PulseAudio/PipeWire API
            const result = await window.electronAPI.systemAudio.listDevices();

            if (result.error) {
                console.error('[Settings] Error from system audio API:', result.error);
                elements.systemAudioDeviceSelect.innerHTML = '<option value="">Error: ' + result.error + '</option>';
                return;
            }

            devices = result.devices || [];

            // Filter to monitors only for Linux
            devices = devices.filter(d => d.isMonitor);

        } else {
            // macOS/Windows: Use desktopCapturer to list screen sources
            const sources = await window.electronAPI.getDesktopSources();

            if (sources && sources.length > 0) {
                // Create virtual device entries for screen sources
                devices = sources
                    .filter(s => s.id.startsWith('screen:'))
                    .map(s => ({
                        id: s.id,
                        name: s.id,
                        displayName: s.name + ' (System Audio)',
                        isMonitor: true
                    }));
            }
        }

        elements.systemAudioDeviceSelect.innerHTML = '';

        if (devices.length === 0) {
            const noDeviceMsg = platform === 'linux'
                ? 'No monitor devices found - is PulseAudio running?'
                : 'No screen sources found';
            elements.systemAudioDeviceSelect.innerHTML = '<option value="">' + noDeviceMsg + '</option>';
            return;
        }

        // Add a default option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select a source --';
        elements.systemAudioDeviceSelect.appendChild(defaultOpt);

        // Add devices/sources
        const optgroup = document.createElement('optgroup');
        optgroup.label = platform === 'linux' ? '🔊 System Audio (Monitors)' : '🖥️ Screen Audio Sources';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.name;
            option.textContent = device.displayName;
            optgroup.appendChild(option);
        });
        elements.systemAudioDeviceSelect.appendChild(optgroup);

        // Restore saved selection
        if (config.systemAudioDeviceId) {
            elements.systemAudioDeviceSelect.value = config.systemAudioDeviceId;
        }

        // Update hint
        const hintEl = document.getElementById('audio-hint');
        if (hintEl) {
            if (devices.length > 0) {
                const sourceType = platform === 'linux' ? 'monitor device(s)' : 'screen source(s)';
                hintEl.innerHTML = `
                    <strong>Microphone:</strong> Used in Microphone mode.<br>
                    <strong>System Audio:</strong> ✅ ${devices.length} ${sourceType} found. Select one to capture system audio.
                `;
            } else {
                const helpMsg = platform === 'linux'
                    ? 'Make sure PulseAudio/PipeWire is running.'
                    : 'Grant screen recording permission in System Preferences.';
                hintEl.innerHTML = `
                    <strong>Microphone:</strong> Used in Microphone mode.<br>
                    <strong>System Audio:</strong> ⚠️ No sources found. ${helpMsg}
                `;
            }
        }

    } catch (error) {
        console.error('[Settings] Failed to enumerate devices:', error);
        elements.systemAudioDeviceSelect.innerHTML = '<option value="">Error - click refresh</option>';
    }
}

// ==========================================
// Model Selection
// ==========================================

// Provider labels for UI display (clean text, no icons)
const PROVIDER_LABELS = {
    'openai': 'OpenAI',
    'google': 'Gemini'
};

function getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || provider;
}

async function populateProviderOptions() {
    try {
        // Get models configuration from main process
        const modelsConfig = await window.electronAPI.getModels();

        if (elements.providerSelect && modelsConfig?.providers) {
            elements.providerSelect.innerHTML = '';
            Object.keys(modelsConfig.providers).forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = getProviderLabel(provider);
                elements.providerSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load providers configuration:', error);
        // Fallback to default options
        if (elements.providerSelect) {
            elements.providerSelect.innerHTML = `
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
            `;
        }
    }
}

// Tier configuration with labels and descriptions for tooltips
const TIER_CONFIG = {
    'fast': {
        label: 'Fast',
        description: 'Faster responses with good quality'
    },
    'balanced': {
        label: 'Balanced',
        description: 'Best balance of speed and quality'
    },
    'quality': {
        label: 'Quality',
        description: 'Highest quality, more detailed responses'
    }
};

function getTierLabel(tier, provider = null) {
    const baseLabel = TIER_CONFIG[tier]?.label || tier;
    // Show "(Free)" suffix for Fast tier when using Gemini (google provider)
    if (tier === 'fast' && provider === 'google') {
        return baseLabel + ' (Free)';
    }
    return baseLabel;
}

function getTierDescription(tier) {
    return TIER_CONFIG[tier]?.description || '';
}

async function populateModelOptions() {
    const tierContainer = document.getElementById('tier-buttons');
    if (!tierContainer) return;

    try {
        // Get models configuration from main process
        const modelsConfig = await window.electronAPI.getModels();
        const tiers = modelsConfig?.tiers || ['fast', 'balanced', 'quality'];

        renderTierButtons(tierContainer, tiers);
    } catch (error) {
        console.error('Failed to load models configuration:', error);
        // Fallback to default tiers
        renderTierButtons(tierContainer, ['fast', 'balanced', 'quality']);
    }
}

function renderTierButtons(container, tiers) {
    container.innerHTML = '';
    const currentTier = config.tier || 'balanced';
    // Get provider from the select element (current value) rather than config
    // This handles the timing when provider changes but config hasn't been saved yet
    const currentProvider = elements.providerSelect?.value || config.provider || 'google';

    tiers.forEach(tier => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tier-btn ${tier === currentTier ? 'active' : ''}`;
        button.dataset.tier = tier;
        button.title = getTierDescription(tier);
        button.textContent = getTierLabel(tier, currentProvider);

        button.addEventListener('click', () => {
            // Update active state
            container.querySelectorAll('.tier-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Save to config
            config.tier = tier;
            autoSaveConfig();
            updateModelDisplay();
        });

        container.appendChild(button);
    });
}

function updateModelDisplay() {
    const currentTier = config.tier || 'balanced';
    if (elements.statusModel) {
        elements.statusModel.textContent = getTierLabel(currentTier, config.provider);
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
// Onboarding Tutorial
// ==========================================

/**
 * Onboarding Steps - Simplified flow with auto-tab-switching
 * Step 0: Click Settings to open
 * Steps 1-7: Guide through all settings with automatic tab navigation
 */
const ONBOARDING_STEPS = [
    // Step 0: Settings button (just highlight, no tooltip)
    {
        id: 'settings-btn',
        targetSelector: '#settings-btn',
        message: '',
        waitForClick: true,
        showTooltip: false,
        tab: null
    },
    // Step 1: Provider selection (API tab)
    {
        id: 'provider',
        targetSelector: '.form-group:has(#provider-select)',
        message: 'Choose your AI provider.',
        waitForClick: false,
        showTooltip: true,
        tab: 'api'
    },
    // Step 2: Quality tier (API tab)
    {
        id: 'tier',
        targetSelector: '.form-group:has(#tier-buttons)',
        message: 'Select quality of response.',
        waitForClick: false,
        showTooltip: true,
        tab: 'api'
    },
    // Step 3: API Key (API tab)
    {
        id: 'api-key',
        targetSelector: '#api-key-container',
        message: 'Enter your API key. Click "Get Key" to create one.',
        waitForClick: false,
        showTooltip: true,
        tab: 'api'
    },
    // Step 4: Language (Behavior tab - auto switches)
    {
        id: 'language',
        targetSelector: '.form-group:has(#language-select)',
        message: 'Select your language.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior'
    },
    // Step 5: System prompt (Behavior tab)
    {
        id: 'system-prompt',
        targetSelector: '.form-group:has(#system-prompt)',
        message: 'Customize how the AI responds.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior'
    },
    // Step 6: Knowledge Base (Knowledge tab - target toolbar buttons)
    {
        id: 'knowledge',
        targetSelector: '.kb-toolbar',
        message: 'Add files for AI context. Click "Fit" to process.',
        waitForClick: false,
        showTooltip: true,
        tab: 'knowledge'
    },
    // Step 7: Audio (Audio tab - target settings grid)
    {
        id: 'audio',
        targetSelector: '#tab-audio .settings-grid',
        message: 'Select microphone and system audio sources.',
        waitForClick: false,
        showTooltip: true,
        tab: 'audio',
        isLastStep: true
    }
];

let currentOnboardingStep = 0;
let onboardingActive = false;

function checkFirstRunOnboarding() {
    if (!config.hasCompletedOnboarding) {
        setTimeout(() => {
            startOnboarding();
        }, 800);
    }
}

function startOnboarding() {
    onboardingActive = true;
    currentOnboardingStep = 0;
    showOnboardingStep(currentOnboardingStep);
}

function showOnboardingStep(stepIndex) {
    const step = ONBOARDING_STEPS[stepIndex];
    if (!step) {
        completeOnboarding();
        return;
    }

    const tooltip = document.getElementById('onboarding-tooltip');
    const stepEl = document.getElementById('onboarding-step');
    const messageEl = document.getElementById('onboarding-message');
    const nextBtn = document.getElementById('onboarding-next-btn');

    // Auto-switch to correct tab if specified
    if (step.tab) {
        const tabBtn = document.querySelector(`.settings-tab[data-tab="${step.tab}"]`);
        if (tabBtn) {
            tabBtn.click();
        }
    }

    // Update content - count only visible steps (exclude step 0)
    const visibleSteps = ONBOARDING_STEPS.filter(s => s.showTooltip !== false);
    const visibleIndex = visibleSteps.findIndex(s => s.id === step.id) + 1;

    if (step.showTooltip !== false) {
        stepEl.textContent = `Step ${visibleIndex} of ${visibleSteps.length}`;
        messageEl.textContent = step.message;
    }

    // Show/hide Next button
    if (step.waitForClick) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = '';
        nextBtn.textContent = step.isLastStep ? 'Done' : 'Next';
    }

    // Remove previous highlight
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    // Small delay to let tab switch complete
    setTimeout(() => {
        const target = document.querySelector(step.targetSelector);
        if (target) {
            target.classList.add('onboarding-highlight');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Position tooltip opposite to target (never overlap)
            positionTooltipOpposite(tooltip, target);

            // Add click listener for waitForClick steps
            if (step.waitForClick) {
                const clickHandler = () => {
                    target.removeEventListener('click', clickHandler);
                    setTimeout(() => nextOnboardingStep(), 300);
                };
                target.addEventListener('click', clickHandler);
            }
        }

        // Show/hide tooltip
        if (step.showTooltip === false) {
            tooltip.classList.add('hidden');
        } else {
            tooltip.classList.remove('hidden');
        }
    }, step.tab ? 150 : 0);
}

/**
 * Position tooltip opposite to target element
 * If target is in upper half of screen -> tooltip at bottom
 * If target is in lower half of screen -> tooltip at top
 */
function positionTooltipOpposite(tooltip, target) {
    const targetRect = target.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const targetCenter = targetRect.top + targetRect.height / 2;

    // Reset position classes
    tooltip.classList.remove('position-top', 'position-bottom');

    if (targetCenter < windowHeight / 2) {
        // Target is in upper half -> put tooltip at bottom
        tooltip.classList.add('position-bottom');
        tooltip.style.top = 'auto';
        tooltip.style.bottom = '10px';
    } else {
        // Target is in lower half -> put tooltip at top
        tooltip.classList.add('position-top');
        tooltip.style.bottom = 'auto';
        tooltip.style.top = '50px';
    }
}

/**
 * Position tooltip below the main toolbar for Step 1
 * This ensures visibility when the app is in its compact toolbar state
 */
function positionTooltipBelowToolbar(tooltip, target) {
    const appContainer = document.getElementById('app-container');
    const containerRect = appContainer ? appContainer.getBoundingClientRect() : target.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    tooltip.className = 'onboarding-tooltip';
    tooltip.style.transform = '';

    // Position below the entire app container
    const top = containerRect.bottom + 12;
    // Align horizontally with the target (Settings button)
    let left = targetRect.left - 100; // Offset to center better

    // Keep on screen
    if (left < 10) left = 10;
    if (left + 260 > window.innerWidth - 10) {
        left = window.innerWidth - 270;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Position arrow to point at the Settings button
    const arrow = tooltip.querySelector('.onboarding-arrow');
    if (arrow) {
        const arrowLeft = Math.max(10, Math.min(targetRect.left - left + targetRect.width / 2, 230));
        arrow.style.left = `${arrowLeft}px`;
        arrow.style.top = '';
    }
}

function positionTooltipNear(tooltip, target, position = 'bottom', extraGap = 0) {
    const targetRect = target.getBoundingClientRect();
    const tooltipWidth = 260; // Smaller for adaptive windows
    const tooltipHeight = 110; // Reduced height estimate (text is shorter now)
    const gap = 10 + extraGap;

    // Reset any transform
    tooltip.style.transform = '';
    tooltip.className = 'onboarding-tooltip';

    let top, left;
    const arrow = tooltip.querySelector('.onboarding-arrow');

    // First try preferred position, then fallback if it doesn't fit
    let finalPosition = position;

    // Check if bottom position would overflow
    if (position === 'bottom' && targetRect.bottom + gap + tooltipHeight > window.innerHeight) {
        // Only flip to top if there is actually space on top!
        if (targetRect.top - gap - tooltipHeight > 0) {
            finalPosition = 'top';
        }
    }
    // Check if top position would overflow
    if (position === 'top' && targetRect.top - gap - tooltipHeight < 0) {
        finalPosition = 'bottom';
    }
    // Check if top position would overflow
    if (position === 'top' && targetRect.top - gap - tooltipHeight < 0) {
        finalPosition = 'bottom';
    }
    // Check if left position would overflow
    if (position === 'left' && targetRect.left - gap - tooltipWidth < 0) {
        finalPosition = 'right';
    }

    switch (finalPosition) {
        case 'left':
            top = targetRect.top + targetRect.height / 2 - 60;
            left = targetRect.left - tooltipWidth - gap;
            tooltip.classList.add('arrow-right');
            if (arrow) {
                arrow.style.left = 'auto';
                arrow.style.top = '30px';
            }
            break;
        case 'right':
            top = targetRect.top + targetRect.height / 2 - 60;
            left = targetRect.right + gap;
            tooltip.classList.add('arrow-left');
            if (arrow) {
                arrow.style.left = '';
                arrow.style.top = '30px';
            }
            break;
        case 'top':
            top = targetRect.top - tooltipHeight - gap;
            left = targetRect.left;
            tooltip.classList.add('arrow-bottom');
            if (arrow) {
                arrow.style.left = `${Math.min(targetRect.width / 2, 80)}px`;
                arrow.style.top = '';
            }
            break;
        case 'bottom':
        default:
            top = targetRect.bottom + gap;
            left = targetRect.left;
            if (arrow) {
                arrow.style.left = `${Math.min(targetRect.width / 2, 80)}px`;
                arrow.style.top = '';
            }
            break;
    }

    // Keep tooltip on screen with safe margins
    const margin = 8;
    if (left < margin) left = margin;
    if (left + tooltipWidth > window.innerWidth - margin) {
        left = window.innerWidth - tooltipWidth - margin;
    }
    if (top < margin) top = margin;
    if (top + tooltipHeight > window.innerHeight - margin) {
        top = window.innerHeight - tooltipHeight - margin;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function nextOnboardingStep() {
    currentOnboardingStep++;
    if (currentOnboardingStep >= ONBOARDING_STEPS.length) {
        completeOnboarding();
    } else {
        showOnboardingStep(currentOnboardingStep);
    }
}

function skipOnboarding() {
    completeOnboarding();
}

function completeOnboarding() {
    onboardingActive = false;

    const tooltip = document.getElementById('onboarding-tooltip');
    if (tooltip) {
        tooltip.classList.add('hidden');
    }

    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    config.hasCompletedOnboarding = true;
    autoSaveConfig();
    console.log('Onboarding completed');
}

// Setup onboarding event listeners
document.addEventListener('DOMContentLoaded', () => {
    const nextBtn = document.getElementById('onboarding-next-btn');
    const skipBtn = document.getElementById('onboarding-skip-btn');
    const closeBtn = document.getElementById('onboarding-skip');

    if (nextBtn) nextBtn.addEventListener('click', nextOnboardingStep);
    if (skipBtn) skipBtn.addEventListener('click', skipOnboarding);
    if (closeBtn) closeBtn.addEventListener('click', skipOnboarding);
});

// ==========================================
// Start Application
// ==========================================

document.addEventListener('DOMContentLoaded', init);
