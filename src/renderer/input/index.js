/**
 * VARS - Input Module
 * Handles input modes (system, microphone, keyboard) and text submission
 */

import { state, INPUT_MODES, setCurrentInputMode } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateStatus } from '../ui/status.js';
import { showTranscription, showResponse } from '../ui/response.js';
import { updateHistory } from '../history/index.js';
import { handleApiError } from '../utils/api-errors.js';
import { autoSaveConfig } from '../settings/auto-save.js';

/**
 * Handle switching between input modes
 * @param {string} mode - The new mode ('system', 'microphone', 'keyboard')
 */
export function handleInputModeChange(mode) {
    setCurrentInputMode(mode);
    state.config.inputMode = mode;
    updateInputModeUI();

    // Save finding config immediately is good practice for mode switch
    autoSaveConfig();

    // Show brief notification
    updateStatus(`Mode: ${INPUT_MODES[mode]?.text || mode}`, 'ready');
}

/**
 * Update UI elements based on current input mode
 */
export function updateInputModeUI() {
    // Determine current configuration
    const modeConfig = INPUT_MODES[state.currentInputMode];

    // Skip if invalid mode (e.g. keyboard isn't in INPUT_MODES, but is handled separately)
    // Actually keyboard is handled as a separate state logic in original code

    const isMac = window.electronAPI.platform === 'darwin';
    // Global shortcuts: macOS uses Option (⌥), others use Ctrl
    const globalMod = isMac ? '⌥' : 'Ctrl';

    if (elements.modeIcon && modeConfig) {
        elements.modeIcon.innerHTML = modeConfig.icon;
    }
    if (elements.modeBtn && modeConfig) {
        elements.modeBtn.title = `${globalMod}+M: ${modeConfig.text}`;
    }
    if (elements.modeBadge && modeConfig) {
        elements.modeBadge.style.borderColor = modeConfig.color;
    }

    // Show/hide keyboard input section
    if (state.currentInputMode === 'keyboard') {
        elements.keyboardInputSection?.classList.remove('hidden');
        elements.recordingSection?.classList.add('hidden');
    } else {
        elements.keyboardInputSection?.classList.add('hidden');
        elements.recordingSection?.classList.remove('hidden');
    }
}

/**
 * Handle standard text input submission (voice command alternative)
 */
export async function handleInputSubmit() {
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

        if (handleApiError(aiResult)) return;

        showResponse(aiResult.response);
        updateStatus('Ready', 'ready');

        // Update History
        updateHistory(text, aiResult.response);

    } catch (error) {
        console.error('Input submit error:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}

/**
 * Handle keyboard mode input submission
 */
export async function handleKeyboardSubmit() {
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

        if (handleApiError(aiResult)) return;

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
