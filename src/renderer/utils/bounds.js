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
    setInterval(() => {
        // Skip bounds update if we are currently zooming to prevent resonance loops
        if (state.isZooming) return;

        if (elements.appContainer) {
            const rect = elements.appContainer.getBoundingClientRect();
            window.electronAPI.sendContentBounds({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
        }
    }, 500); // Slower updates to reduce resize loop risk
}
