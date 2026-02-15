/**
 * VARS - DOM Elements Module
 * Centralized DOM element references
 */

// DOM Elements object - lazy initialized to ensure DOM is ready
let _elements = null;

export function getElements() {
    if (_elements) return _elements;

    _elements = {
        // Main containers
        appContainer: document.getElementById('app-container'),
        contentArea: document.getElementById('content-area'),

        // Toolbar elements
        recBtn: document.getElementById('rec-btn'),
        inputField: document.getElementById('input-field'),
        modeBtn: document.getElementById('mode-btn'),
        modeIcon: document.getElementById('mode-icon'),
        screenshotBtn: document.getElementById('screenshot-btn'),
        smartListenerBtn: document.getElementById('smart-listener-btn'),
        smartListenerBadge: document.getElementById('smart-listener-badge'),
        clickthroughBtn: document.getElementById('clickthrough-btn'),
        settingsBtn: document.getElementById('settings-btn'),
        dragBtn: document.getElementById('drag-btn'),
        settingsDragBtn: document.getElementById('settings-drag-btn'),

        // Status
        statusBar: document.getElementById('status-bar'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
        statusModel: document.getElementById('status-model'),

        // Screenshot actions
        screenshotActions: document.getElementById('screenshot-actions'),
        screenshotTitle: document.getElementById('screenshot-title'),
        actionAnswers: document.getElementById('action-answers'),
        actionCode: document.getElementById('action-code'),
        actionSummary: document.getElementById('action-summary'),
        actionAsk: document.getElementById('action-ask'),
        screenshotAskInput: document.getElementById('screenshot-ask-input'),

        // Content sections
        transcriptionSection: document.getElementById('transcription-section'),
        transcriptionContent: document.getElementById('transcription-content'),
        transcriptionTimestamp: document.getElementById('transcription-timestamp'),
        responseSection: document.getElementById('response-section'),
        responseContent: document.getElementById('response-content'),
        responseTimestamp: document.getElementById('response-timestamp'),
        copyResponseBtn: document.getElementById('copy-response-btn'),

        // Settings panel
        settingsPanel: document.getElementById('settings-panel'),
        backBtn: document.getElementById('back-btn'),
        saveBtn: document.getElementById('save-btn'),
        addFileBtn: document.getElementById('add-file-btn'),
        fileInput: document.getElementById('file-input'),

        // Settings inputs
        apiKeyInput: document.getElementById('api-key'),
        googleApiKeyInput: document.getElementById('google-api-key'),
        modelSelect: document.getElementById('model-select'),
        languageSelect: document.getElementById('language-select'),
        systemPromptInput: document.getElementById('system-prompt'),
        fileList: document.getElementById('file-list'),
        inputDeviceSelect: document.getElementById('input-device'),
        systemAudioDeviceSelect: document.getElementById('system-audio-device'),
        refreshAudioBtn: document.getElementById('refresh-audio-btn'),

        // Connection / Quality / Transcription selects
        connectionTypeSelect: document.getElementById('connection-type'),
        qualityPresetSelect: document.getElementById('quality-preset'),
        transcriptionPresetSelect: document.getElementById('transcription-preset'),

        // Transcription / Whisper
        whisperLocalSection: document.getElementById('whisper-local-section'),
        whisperModelSelect: document.getElementById('whisper-model-select'),
        whisperModelGroup: document.getElementById('whisper-model-group'),
        whisperModelStatus: document.getElementById('whisper-model-status'),
        whisperStatusText: document.getElementById('whisper-status-text'),
        whisperDownloadBtn: document.getElementById('whisper-download-btn'),
        whisperDeleteBtn: document.getElementById('whisper-delete-btn'),
        whisperProgressBar: document.getElementById('whisper-progress-bar'),
        whisperProgressFill: document.getElementById('whisper-progress-fill'),
        whisperProgressText: document.getElementById('whisper-progress-text'),
        trainBtn: document.getElementById('train-btn'),
        resetKbBtn: document.getElementById('reset-kb-btn'),
        kbStatus: document.getElementById('kb-status'),

        // Interface Settings
        opacitySlider: document.getElementById('opacity-slider'),
        opacitySlider: document.getElementById('opacity-slider'),
        opacityValue: document.getElementById('opacity-value'),

        // Update Elements
        updateSection: document.getElementById('update-section'),
        updateMessage: document.getElementById('update-message'),
        updateBtn: document.getElementById('update-btn'),
        checkUpdateBtn: document.getElementById('check-update-btn'),

        // Prompt Optimizer
        optimizePromptBtn: document.getElementById('optimize-prompt-btn'),
        revertPromptBtn: document.getElementById('revert-prompt-btn'),
        generatePromptBtn: document.getElementById('generate-prompt-btn'),
        optimizerActions: document.getElementById('optimizer-actions'),

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
        mainContent: document.getElementById('main-content'),

        // Zoom controls
        zoomInBtn: document.getElementById('zoom-in-btn'),
        zoomOutBtn: document.getElementById('zoom-out-btn')
    };

    return _elements;
}

// Alias for convenience
export const elements = new Proxy({}, {
    get(target, prop) {
        return getElements()[prop];
    }
});
