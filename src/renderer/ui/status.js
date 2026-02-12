/**
 * VARS - Status Module
 * Handles status bar updates and recording UI feedback
 */

import { state } from '../state/index.js';
import { elements } from './elements.js';

// Timer state for recording duration display
let timerInterval = null;
let timerSeconds = 0;

/**
 * Update the status bar with a message and type
 * @param {string} text - Status message (can contain HTML)
 * @param {string} type - Status type: 'ready', 'recording', 'processing', 'error'
 */
export function updateStatus(text, type = 'ready') {
    if (!elements.statusBar) return;

    // Update status text (using innerHTML to allow links/buttons like "Clear")
    if (elements.statusText) {
        elements.statusText.innerHTML = text;
    }

    // Update status dot color based on type
    if (elements.statusDot) {
        elements.statusDot.className = 'status-dot';

        switch (type) {
            case 'recording':
                elements.statusDot.classList.add('recording');
                break;
            case 'processing':
                elements.statusDot.classList.add('processing');
                break;
            case 'error':
                elements.statusDot.classList.add('error');
                break;
            case 'success':
                elements.statusDot.classList.add('success');
                break;
            default:
                elements.statusDot.classList.add('ready');
        }
    }

    // Show/hide status bar based on state
    if (type === 'ready' && text === 'Ready') {
        elements.statusBar.classList.add('hidden');
    } else {
        elements.statusBar.classList.remove('hidden');
    }
}

/**
 * Update recording UI elements based on recording state
 */
export function updateRecordingUI() {
    if (elements.recBtn) {
        if (state.isRecording) {
            elements.recBtn.classList.add('recording');
        } else {
            elements.recBtn.classList.remove('recording');
        }
    }

    // Update notification dot visibility (red dot indicates recording)
    const notifDot = document.querySelector('.notif-dot');
    if (notifDot) {
        notifDot.style.display = state.isRecording ? 'block' : 'none';
    }

    // Update recording timer display
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
        if (state.isRecording) {
            timerSeconds = 0;
            timerDisplay.textContent = '00:00';
            timerInterval = setInterval(() => {
                timerSeconds++;
                const minutes = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
                const seconds = (timerSeconds % 60).toString().padStart(2, '0');
                timerDisplay.textContent = `${minutes}:${seconds}`;
            }, 1000);
        } else {
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }
    }

    // Update recording indicator if exists (legacy)
    if (elements.recordingIndicator) {
        elements.recordingIndicator.classList.toggle('active', state.isRecording);
    }

    if (elements.recordingText) {
        elements.recordingText.textContent = state.isRecording ? 'Recording...' : 'Click to record';
    }
}

/**
 * Hide the status bar
 */
export function hideStatus() {
    if (elements.statusBar) {
        elements.statusBar.classList.add('hidden');
    }
}

/**
 * Show a temporary status message that auto-hides
 * @param {string} text - Status message
 * @param {string} type - Status type
 * @param {number} duration - Duration in ms before hiding
 */
export function showTemporaryStatus(text, type = 'ready', duration = 3000) {
    updateStatus(text, type);
    setTimeout(() => {
        hideStatus();
    }, duration);
}
