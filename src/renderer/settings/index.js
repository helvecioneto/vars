/**
 * VARS - Settings Module
 * Handles settings panel toggle and tab navigation
 */

import { state, setCurrentMode } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { startQRCodeCarousel, stopQRCodeCarousel } from './qr-carousel.js';
import { initConnectionType, initCodexAuth } from './api-key.js';
import { updateModelDisplay } from './model-selection.js';
import { populateDevices, populateSystemAudioDevices } from './devices.js';
import { setupAutoSave } from './auto-save.js';
import { updateFileList } from './knowledge-base.js';
import { initInterfaceSettings } from './interface.js';
import { initWhisperSettings } from './whisper.js';

/**
 * Populate quality preset <select> with model names from models.json
 */
async function populateQualityPresetOptions() {
    const qualitySelect = document.getElementById('quality-preset');
    if (!qualitySelect) return;

    try {
        const modelsConfig = await window.electronAPI.getModels();
        if (!modelsConfig?.providers) return;

        // Clear all but the first "Auth" option
        qualitySelect.innerHTML = '<option value="auth">Auth (Default)</option>';

        // Helper: get first model name (handle arrays for free tier)
        const getModelName = (provider, tier) => {
            const tierConfig = modelsConfig.providers[provider]?.[tier];
            if (!tierConfig?.analyze) return null;
            const model = Array.isArray(tierConfig.analyze) ? tierConfig.analyze[0] : tierConfig.analyze;
            return model;
        };

        // Tier labels
        const tierLabels = { free: 'Free', fast: 'Fast', balanced: 'Balanced', quality: 'Quality' };

        // OpenAI group
        const openaiGroup = document.createElement('optgroup');
        openaiGroup.label = 'OpenAI (API Key)';
        ['fast', 'balanced', 'quality'].forEach(tier => {
            const model = getModelName('openai', tier);
            if (model) {
                const opt = document.createElement('option');
                opt.value = `openai-${tier}`;
                opt.textContent = `${tierLabels[tier]} (${model})`;
                openaiGroup.appendChild(opt);
            }
        });
        if (openaiGroup.children.length > 0) qualitySelect.appendChild(openaiGroup);

        // Gemini group
        const googleGroup = document.createElement('optgroup');
        googleGroup.label = 'Gemini (API Key)';
        ['free', 'fast', 'balanced', 'quality'].forEach(tier => {
            const model = getModelName('google', tier);
            if (model) {
                const opt = document.createElement('option');
                opt.value = `google-${tier}`;
                opt.textContent = `${tierLabels[tier]} (${model})`;
                googleGroup.appendChild(opt);
            }
        });
        if (googleGroup.children.length > 0) qualitySelect.appendChild(googleGroup);
    } catch (error) {
        console.error('[Settings] Failed to populate quality presets:', error);
        // Fallback
        qualitySelect.innerHTML = `
            <option value="auth">Auth (Default)</option>
            <optgroup label="OpenAI (API Key)">
                <option value="openai-fast">Fast</option>
                <option value="openai-balanced">Balanced</option>
                <option value="openai-quality">Quality</option>
            </optgroup>
            <optgroup label="Gemini (API Key)">
                <option value="google-free">Free</option>
                <option value="google-fast">Fast</option>
                <option value="google-balanced">Balanced</option>
                <option value="google-quality">Quality</option>
            </optgroup>
        `;
    }
}

/**
 * Initialize settings module
 */
export async function initSettings() {
    // Populate quality preset options with model names
    await populateQualityPresetOptions();

    // Apply config to UI first
    applyConfigToUI();

    // Initial devices population
    await populateDevices();
    await populateSystemAudioDevices();

    // Setup auto-save listeners
    setupAutoSave();

    // Setup tabs
    setupSettingsTabs();

    // Init Interface Settings (Opacity)
    initInterfaceSettings();

    // Init Connection Type selector and Codex Auth
    initConnectionType();
    initCodexAuth();

    // Init Local Whisper Settings
    initWhisperSettings();
}

/**
 * Apply current configuration to UI elements
 */
export function applyConfigToUI() {
    if (elements.apiKeyInput) elements.apiKeyInput.value = state.config.apiKey || '';

    // Google API Key
    if (elements.googleApiKeyInput) {
        elements.googleApiKeyInput.value = state.config.googleApiKey || '';
    }

    // Connection type
    const connectionSelect = document.getElementById('connection-type');
    if (connectionSelect) {
        connectionSelect.value = state.config.connectionType || 'oauth';
    }

    // Quality preset
    const qualitySelect = document.getElementById('quality-preset');
    if (qualitySelect) {
        qualitySelect.value = state.config.qualityPreset || 'auth';
    }

    // Transcription preset
    const transcriptionSelect = document.getElementById('transcription-preset');
    if (transcriptionSelect) {
        transcriptionSelect.value = state.config.transcriptionPreset || 'local';
    }

    // Whisper model
    if (elements.whisperModelSelect) {
        elements.whisperModelSelect.value = state.config.whisperModel || 'small';
    }

    // Language
    if (elements.languageSelect) {
        elements.languageSelect.value = state.config.language || 'en';
    }

    // System Prompt
    if (elements.systemPromptInput) {
        elements.systemPromptInput.value = state.config.systemPrompt || '';
    }

    // Brief Mode
    if (elements.briefModeCheckbox) {
        elements.briefModeCheckbox.checked = state.config.briefMode || false;
    }

    updateFileList();
    updateModelDisplay();
}

/**
 * Toggle settings panel visibility
 */
export function toggleSettings() {
    const isVisible = elements.settingsPanel.classList.toggle('visible');
    elements.settingsBtn.classList.toggle('active', isVisible);

    // Get UI elements
    const toolbarLeft = document.querySelector('.toolbar-left');
    const toolbarRight = document.querySelector('.toolbar-right');
    const inputField = document.getElementById('input-field');
    const settingsModeTitle = document.getElementById('settings-mode-title');
    const contentArea = elements.contentArea;
    const toolbarPills = document.getElementById('toolbar-pills');
    const toastBar = document.getElementById('toast-bar');

    if (isVisible) {
        // Switching TO settings mode
        setCurrentMode('settings');

        // Settings open: hide all icons except gear, show settings title
        if (toolbarLeft) toolbarLeft.classList.add('hidden');
        if (inputField) inputField.style.display = 'none';
        if (toolbarPills) toolbarPills.classList.add('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.remove('hidden');
        if (contentArea) contentArea.classList.add('hidden');
        if (toastBar) toastBar.classList.add('hidden');

        // Hide other toolbar buttons (keep only settings and drag)
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn:not(#settings-btn):not(#close-btn):not(#drag-btn)');
        otherButtons?.forEach(btn => btn.classList.add('hidden'));

        // Hide timer
        const timerControl = document.getElementById('timer-control');
        if (timerControl) timerControl.classList.add('hidden');
    } else {
        // Switching TO toolbar mode
        setCurrentMode('toolbar');

        // Settings closed: restore everything
        if (toolbarLeft) toolbarLeft.classList.remove('hidden');
        if (toolbarPills) toolbarPills.classList.remove('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.add('hidden');
        if (toastBar) toastBar.classList.remove('hidden');

        // Show toolbar buttons
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn');
        otherButtons?.forEach(btn => btn.classList.remove('hidden'));

        // Show timer
        const timerControl = document.getElementById('timer-control');
        if (timerControl) timerControl.classList.remove('hidden');
    }

    // No resize needed — overlay mode with floating components
}

/**
 * Setup settings tabs navigation
 */
export function setupSettingsTabs() {
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

            // Handle QR code carousel for About tab
            if (targetTab === 'about') {
                startQRCodeCarousel();
            } else {
                stopQRCodeCarousel();
            }
        });
    });
}
