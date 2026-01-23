/**
 * VARS - Zoom Control Module
 * Handles zoom in/out functionality
 */

import { state, setZooming, setZoomTimeout } from '../state/index.js';

/**
 * Zoom in
 */
export function zoomIn() {
    setZoomingState();
    window.electronAPI.zoomIn();
    console.log('Zoom in');
}

/**
 * Zoom out
 */
export function zoomOut() {
    setZoomingState();
    window.electronAPI.zoomOut();
    console.log('Zoom out');
}

/**
 * Reset zoom
 */
export function resetZoom() {
    setZoomingState();
    window.electronAPI.resetZoom();
    console.log('Zoom reset');
}

/**
 * Set zooming state to prevent resize loops
 */
export function setZoomingState() {
    setZooming(true);
    if (state.zoomTimeout) {
        clearTimeout(state.zoomTimeout);
    }
    setZoomTimeout(setTimeout(() => {
        setZooming(false);
    }, 1500));
}

/**
 * Handle zoom shortcuts from main process
 * @param {string} key - The key pressed ('+', '-', '0')
 */
export function handleZoomShortcut(key) {
    if (key === '+' || key === '=' || key === 'plus') {
        zoomIn();
    } else if (key === '-' || key === 'minus') {
        zoomOut();
    } else if (key === '0') {
        resetZoom();
    }
}
