/**
 * VARS - Main Entry Point
 * Initializes the renderer process
 */

import { state, setConfig, setCurrentInputMode } from './state/index.js';
import { elements } from './ui/elements.js'; // Lazily accessed, but we rely on DOMContentLoaded
import { initSettings, applyConfigToUI } from './settings/index.js';
import { setupEventListeners } from './events/index.js';
import { initCustomTooltips, updateButtonTooltips } from './ui/tooltips.js';
import { startBoundsTracking } from './utils/bounds.js';
import { checkFirstRunOnboarding } from './onboarding/index.js';
import { updateInputModeUI } from './input/index.js';
import { updateModelDisplay } from './settings/model-selection.js';
import { initUpdates } from './settings/updates.js';

/**
 * Initialize application
 */
async function init() {
    try {
        console.log('Initializing VARS Renderer...');

        // Load config from main process
        const config = await window.electronAPI.getConfig();
        setConfig(config);

        // Initialize state from config
        const inputMode = config.inputMode || 'system';
        setCurrentInputMode(inputMode);

        // Initialize Settings (populates providers, models, devices)
        await initSettings();

        // Update UI based on config and state
        updateInputModeUI();
        updateButtonTooltips();

        // Initialize tooltips system
        initCustomTooltips();

        // Initialize updates
        initUpdates();

        // Setup Event Listeners
        setupEventListeners();

        // Start tracking window bounds
        startBoundsTracking();

        console.log('VARS Renderer initialized successfully');

        // Check onboarding
        checkFirstRunOnboarding();

    } catch (error) {
        console.error('Failed to initialize application:', error);
    }
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
