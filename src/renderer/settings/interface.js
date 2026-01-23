/**
 * VARS - Interface Settings Module
 * Handles interface customization like transparency
 */

import { state, setOpacity } from '../state/index.js';
import { elements } from '../ui/elements.js';

/**
 * Initialize interface settings
 */
export function initInterfaceSettings() {
    // Load saved opacity
    const savedOpacity = state.config.opacity || 1.0;
    updateOpacity(savedOpacity);

    // Setup slider listener
    if (elements.opacitySlider) {
        elements.opacitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            updateOpacity(value);
        });

        // Save on change (end of drag)
        elements.opacitySlider.addEventListener('change', (e) => {
            const value = parseFloat(e.target.value);
            saveOpacityConfig(value);
        });
    }

    // Listen for opacity changes from main process (hotkeys)
    window.electronAPI.onOpacityChanged((opacity) => {
        updateOpacity(opacity);
        // Debounce save for hotkey changes
        if (state.saveTimeout) clearTimeout(state.saveTimeout);
        state.saveTimeout = setTimeout(() => {
            saveOpacityConfig(opacity);
        }, 1000);
    });
}

/**
 * Update opacity state and UI
 * @param {number} value - Opacity value (0.2 to 1.0)
 */
export function updateOpacity(value) {
    // Clamp value
    const opacity = Math.max(0.2, Math.min(1.0, value));

    setOpacity(opacity);

    // Update UI
    if (elements.opacitySlider) {
        elements.opacitySlider.value = opacity;
    }
    if (elements.opacityValue) {
        elements.opacityValue.textContent = `${Math.round(opacity * 100)}%`;
    }

    // Apply immediate visual change if not handled by IPC (but here we use IPC)
    window.electronAPI.setOpacity(opacity);
}

/**
 * Save opacity to config
 * @param {number} value 
 */
async function saveOpacityConfig(value) {
    state.config.opacity = value;
    await window.electronAPI.saveConfig(state.config);
    console.log(`Opacity saved: ${value}`);
}
