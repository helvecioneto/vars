/**
 * VARS - State Management Module
 * Centralized state for the renderer process
 */

// Global state object - shared across all modules
export const state = {
    // Recording state
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],

    // Configuration
    config: {},

    // Window Opacity
    opacity: 1.0,

    // Input mode: 'system', 'microphone', 'keyboard'
    currentInputMode: 'system',

    // Zoom state
    currentZoom: 100, // Zoom percentage (70-120)
    isZooming: false, // Flag to pause auto-resize during zoom operations
    zoomTimeout: null,

    // History navigation
    historyIndex: -1, // -1 = current/live, 0 = oldest, etc.

    // Realtime audio streaming
    realtimeActive: false,
    audioContext: null,
    scriptProcessor: null,

    // Screenshot state
    pendingScreenshot: null,

    // Last prompt for regeneration
    lastPrompt: '',

    // Visibility mode (default: invisible/hidden for screen sharing protection)
    isVisibleMode: false,

    // Window height state for different modes
    toolbarModeHeight: 60,  // Default compact toolbar height
    settingsModeHeight: 350, // Default settings panel height
    currentMode: 'toolbar', // 'toolbar' or 'settings'

    // Recording transcription state
    fullTranscription: '',
    isTranscribing: false,
    isFinalizing: false, // Flag to prevent intermediate transcriptions during finalization
    transcriptionInterval: null,

    // Auto-save
    saveTimeout: null,

    // QR Code carousel
    qrCodeInterval: null,
    currentQRIndex: 0,

    // Free tier retry
    retryResetTimeout: null,

    // Onboarding
    currentOnboardingStep: 0,
    onboardingActive: false
};

// Constants
export const MIN_ZOOM = 70;
export const MAX_ZOOM = 120;
export const ZOOM_STEP = 10;

export const QR_CODES = [
    { id: 'paypal', label: 'PayPal', indicatorId: 'indicator-paypal' },
    { id: 'pix', label: 'Pix (Brasil)', indicatorId: 'indicator-pix' }
];

// Input mode configuration (only audio modes, text input is always available)
export const INPUT_MODES = {
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

// Provider labels for UI display
export const PROVIDER_LABELS = {
    'openai': 'OpenAI',
    'google': 'Gemini'
};

// Tier configuration with labels and descriptions
export const TIER_CONFIG = {
    'free': {
        label: 'Free',
        description: 'Free tier with basic capabilities'
    },
    'fast': {
        label: 'Fast',
        description: 'Optimized for speed, quick responses'
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

// State setter functions for controlled state modifications
export function setConfig(newConfig) {
    state.config = newConfig;
}

export function updateConfig(updates) {
    state.config = { ...state.config, ...updates };
}

export function setRecording(value) {
    state.isRecording = value;
}

export function setMediaRecorder(recorder) {
    state.mediaRecorder = recorder;
}

export function setAudioChunks(chunks) {
    state.audioChunks = chunks;
}

export function clearAudioChunks() {
    state.audioChunks = [];
}

export function addAudioChunk(chunk) {
    state.audioChunks.push(chunk);
}

export function setCurrentInputMode(mode) {
    state.currentInputMode = mode;
}

export function setZooming(value) {
    state.isZooming = value;
}

export function setZoomTimeout(timeout) {
    state.zoomTimeout = timeout;
}

export function setHistoryIndex(index) {
    state.historyIndex = index;
}

export function setPendingScreenshot(screenshot) {
    state.pendingScreenshot = screenshot;
}

export function setLastPrompt(prompt) {
    state.lastPrompt = prompt;
}

export function setVisibleMode(value) {
    state.isVisibleMode = value;
}

export function setCurrentMode(mode) {
    state.currentMode = mode;
}

export function setToolbarModeHeight(height) {
    state.toolbarModeHeight = height;
}

export function setSettingsModeHeight(height) {
    state.settingsModeHeight = height;
}

export function setTranscribing(value) {
    state.isTranscribing = value;
}

export function setFinalizing(value) {
    state.isFinalizing = value;
}

export function setFullTranscription(text) {
    state.fullTranscription = text;
}

export function setTranscriptionInterval(interval) {
    state.transcriptionInterval = interval;
}

export function setSaveTimeout(timeout) {
    state.saveTimeout = timeout;
}

export function setRealtimeActive(value) {
    state.realtimeActive = value;
}

export function setAudioContext(ctx) {
    state.audioContext = ctx;
}

export function setScriptProcessor(processor) {
    state.scriptProcessor = processor;
}

export function setOnboardingActive(value) {
    state.onboardingActive = value;
}

export function setCurrentOnboardingStep(step) {
    state.currentOnboardingStep = step;
}

export function setQRCodeInterval(interval) {
    state.qrCodeInterval = interval;
}

export function setCurrentQRIndex(index) {
    state.currentQRIndex = index;
}

export function setRetryResetTimeout(timeout) {
    state.retryResetTimeout = timeout;
}

export function setOpacity(value) {
    state.opacity = value;
}
