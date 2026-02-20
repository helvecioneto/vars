/**
 * VARS - Bounds Tracking Module
 * Tracks content bounds for click-through functionality
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';

/**
 * Start tracking bounds for click-through functionality
 * Sends bounds updates to main process periodically
 */
export function startBoundsTracking() {
    // Send bounds less frequently to avoid conflicts with zoom
    // On Linux, use longer interval to prevent resize loops
    const isLinux = window.electronAPI.platform === 'linux';
    const updateInterval = isLinux ? 1000 : 500; // 1000ms on Linux, 500ms on other platforms

    setInterval(() => {
        // Skip bounds update if we are currently zooming to prevent resonance loops
        if (state.isZooming) return;

        if (elements.appContainer) {
            const rect = elements.appContainer.getBoundingClientRect();
            window.electronAPI.sendContentBounds({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height + 48 // Add padding space (24px top + 24px bottom)
            });
        }
    }, updateInterval); // Slower updates to reduce resize loop risk
}
