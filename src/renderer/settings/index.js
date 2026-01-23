/**
 * VARS - Settings Module
 * Handles settings panel toggle and tab navigation
 */

import { state, setCurrentMode } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { startQRCodeCarousel, stopQRCodeCarousel } from './qr-carousel.js';
import { updateAPIKeyVisibility } from './api-key.js';
import { populateProviderOptions, populateModelOptions, updateModelDisplay } from './model-selection.js';
import { populateDevices, populateSystemAudioDevices } from './devices.js';
import { setupAutoSave } from './auto-save.js';
import { updateFileList } from './knowledge-base.js';
import { initInterfaceSettings } from './interface.js';

/**
 * Initialize settings module
 */
export async function initSettings() {
    // Populate provider options first
    await populateProviderOptions();

    // Apply config to UI before populating model options
    applyConfigToUI();

    // Now populate model options (tier buttons) - they need provider to be set
    await populateModelOptions();

    // Initial devices population
    await populateDevices();
    await populateSystemAudioDevices(); // Potentially slow on first load

    // Setup auto-save listeners
    setupAutoSave();

    // Setup tabs
    setupSettingsTabs();

    // Init Interface Settings (Opacity)
    initInterfaceSettings();
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

    // Set provider
    if (elements.providerSelect) {
        elements.providerSelect.value = state.config.provider || 'openai';
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

    // Update API Key visibility based on provider
    updateAPIKeyVisibility();

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

    if (isVisible) {
        // Switching TO settings mode
        setCurrentMode('settings');

        // Settings open: hide all icons except gear, show settings title
        if (toolbarLeft) toolbarLeft.classList.add('hidden');
        if (inputField) inputField.classList.add('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.remove('hidden');
        if (contentArea) contentArea.classList.add('hidden');

        // Hide other toolbar buttons (keep only settings and drag)
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn:not(#settings-btn):not(#close-btn):not(#drag-btn)');
        otherButtons?.forEach(btn => btn.classList.add('hidden'));
    } else {
        // Switching TO toolbar mode
        setCurrentMode('toolbar');

        // Settings closed: restore everything
        if (toolbarLeft) toolbarLeft.classList.remove('hidden');
        if (inputField) inputField.classList.remove('hidden');
        if (settingsModeTitle) settingsModeTitle.classList.add('hidden');

        // Show toolbar buttons
        const otherButtons = toolbarRight?.querySelectorAll('.icon-btn');
        otherButtons?.forEach(btn => btn.classList.remove('hidden'));
    }

    // Force immediate content bounds update after DOM changes settle
    // This bypasses the normal cooldown to ensure window resizes correctly
    setTimeout(() => {
        if (elements.appContainer) {
            const rect = elements.appContainer.getBoundingClientRect();
            window.electronAPI.forceResizeToContent({
                width: rect.width,
                height: rect.height
            });
        }
    }, 100);
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
