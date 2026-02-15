/**
 * VARS - Auto-Save Module
 * Handles automatic saving of configuration changes
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateModelDisplay } from './model-selection.js';
import { populateSystemAudioDevices } from './devices.js';

let saveTimeout = null;

/**
 * Setup auto-save listeners for all settings inputs
 */
export function setupAutoSave() {
    // Add change listeners to all settings inputs
    const inputs = [
        elements.apiKeyInput,
        elements.googleApiKeyInput,
        elements.languageSelect,
        elements.systemPromptInput,
        elements.inputDeviceSelect,
        elements.whisperModelSelect
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', autoSaveConfig);
            input.addEventListener('input', debounceAutoSave);
        }
    });

    // Connection type, quality preset, transcription preset selects
    const connectionType = document.getElementById('connection-type');
    const qualityPreset = document.getElementById('quality-preset');
    const transcriptionPreset = document.getElementById('transcription-preset');

    if (connectionType) connectionType.addEventListener('change', autoSaveConfig);
    if (qualityPreset) qualityPreset.addEventListener('change', autoSaveConfig);
    if (transcriptionPreset) transcriptionPreset.addEventListener('change', autoSaveConfig);

    // System audio device selection
    if (elements.systemAudioDeviceSelect) {
        elements.systemAudioDeviceSelect.addEventListener('change', async (e) => {
            state.config.systemAudioDeviceId = e.target.value;
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

/**
 * Debounced auto-save function
 */
export function debounceAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSaveConfig, 500);
}

/**
 * Derive provider, tier, useCodexAuth, transcriptionEngine from presets
 */
function deriveConfigFromPresets() {
    const connectionType = document.getElementById('connection-type')?.value || 'oauth';
    const qualityPreset = document.getElementById('quality-preset')?.value || 'auth';
    const transcriptionPreset = document.getElementById('transcription-preset')?.value || 'local';

    // Save the preset values
    state.config.connectionType = connectionType;
    state.config.qualityPreset = qualityPreset;
    state.config.transcriptionPreset = transcriptionPreset;

    // Derive authMode
    state.config.authMode = connectionType === 'oauth' ? 'login' : 'api';

    // Derive provider, tier, useCodexAuth from qualityPreset
    if (qualityPreset === 'auth') {
        // "Auth" uses the connection type's provider
        if (connectionType === 'google-api') {
            state.config.provider = 'google';
        } else {
            state.config.provider = 'openai';
        }
        state.config.tier = 'balanced';
        state.config.useCodexAuth = (connectionType === 'oauth');
    } else {
        // Specific preset: "openai-fast", "google-balanced", etc.
        const dashIndex = qualityPreset.indexOf('-');
        const providerPart = qualityPreset.substring(0, dashIndex);
        const tierPart = qualityPreset.substring(dashIndex + 1);
        state.config.provider = providerPart === 'google' ? 'google' : 'openai';
        state.config.tier = tierPart;
        state.config.useCodexAuth = false;
    }

    // Derive transcriptionEngine from transcriptionPreset
    state.config.transcriptionEngine = transcriptionPreset === 'local' ? 'local' : 'api';
}

/**
 * Save configuration to file
 */
export async function autoSaveConfig() {
    if (saveTimeout) clearTimeout(saveTimeout);

    // Derive provider/tier/auth from the preset selectors
    deriveConfigFromPresets();

    // Save direct input values
    state.config.apiKey = elements.apiKeyInput?.value?.trim() || '';
    state.config.googleApiKey = elements.googleApiKeyInput?.value?.trim() || '';
    state.config.language = elements.languageSelect?.value || 'en';
    state.config.systemPrompt = elements.systemPromptInput?.value?.trim() || '';
    state.config.inputDeviceId = elements.inputDeviceSelect?.value || 'default';
    state.config.systemAudioDeviceId = elements.systemAudioDeviceSelect?.value || '';
    state.config.inputMode = state.currentInputMode;
    state.config.briefMode = elements.briefModeCheckbox?.checked || false;
    state.config.whisperModel = elements.whisperModelSelect?.value || 'small';

    try {
        console.log('[AutoSave] Saving config. hasCompletedOnboarding:', state.config.hasCompletedOnboarding);
        await window.electronAPI.saveConfig(state.config);
        updateModelDisplay();
        console.log('Settings auto-saved');
    } catch (error) {
        console.error('Failed to auto-save settings:', error);
    }
}
