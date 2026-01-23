/**
 * VARS - Visibility Module
 * Handles visibility mode toggle for screen sharing protection
 */

import { state, setVisibleMode } from '../state/index.js';
import { updateButtonTooltips } from './tooltips.js';

/**
 * Toggle visibility mode between hidden (invisible to screen sharing) and visible
 * When visible, applies a glowing border effect to indicate the app can be seen
 */
export function toggleVisibilityMode() {
    setVisibleMode(!state.isVisibleMode);

    const toggle = document.getElementById('visibility-toggle');
    const appContainer = document.getElementById('app-container');
    const label = document.querySelector('.visibility-label');

    if (state.isVisibleMode) {
        // Switch to visible mode
        if (toggle) toggle.classList.add('visible');
        if (appContainer) appContainer.classList.add('visible-mode');
        if (label) label.textContent = 'Visible';
    } else {
        // Switch to hidden mode (default)
        if (toggle) toggle.classList.remove('visible');
        if (appContainer) appContainer.classList.remove('visible-mode');
        if (label) label.textContent = 'Hidden';
    }

    // Update tooltip text for visibility toggle
    updateButtonTooltips();

    // Communicate with main process to toggle content protection
    // Content protection enabled = invisible to screen sharing
    window.electronAPI.setContentProtection(!state.isVisibleMode);

    console.log(`Visibility mode: ${state.isVisibleMode ? 'VISIBLE' : 'HIDDEN'}`);
}
