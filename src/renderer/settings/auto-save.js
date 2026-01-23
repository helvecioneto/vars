/**
 * VARS - Auto-Save Module
 * Handles automatic saving of configuration changes
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateAPIKeyVisibility } from './api-key.js';
import { populateModelOptions, updateModelDisplay } from './model-selection.js';
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
 * Save configuration to file
 */
export async function autoSaveConfig() {
    if (saveTimeout) clearTimeout(saveTimeout);

    state.config.apiKey = elements.apiKeyInput?.value?.trim() || '';
    state.config.googleApiKey = elements.googleApiKeyInput?.value?.trim() || '';
    // Save provider and tier
    state.config.provider = elements.providerSelect?.value || 'openai';
    // Tier is managed by tier buttons
    const activeTierBtn = document.querySelector('.tier-btn.active');
    state.config.tier = activeTierBtn?.dataset?.tier || state.config.tier || 'balanced';
    state.config.language = elements.languageSelect?.value || 'en';
    state.config.systemPrompt = elements.systemPromptInput?.value?.trim() || '';
    state.config.inputDeviceId = elements.inputDeviceSelect?.value || 'default';
    state.config.systemAudioDeviceId = elements.systemAudioDeviceSelect?.value || '';
    state.config.inputMode = state.currentInputMode;
    state.config.briefMode = elements.briefModeCheckbox?.checked || false;

    try {
        await window.electronAPI.saveConfig(state.config);
        updateModelDisplay();
        console.log('Settings auto-saved');
    } catch (error) {
        console.error('Failed to auto-save settings:', error);
    }
}
