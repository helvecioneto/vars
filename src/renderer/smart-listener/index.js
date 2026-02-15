/**
 * VARS - Smart Listener Renderer Module
 * Handles the Smart Listener UI toggle, analysis scheduling,
 * and communication with the response window
 */

import { state, setSmartListenerEnabled, setSmartListenerQueue, setSmartListenerAnalysisInterval } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { formatResponse } from '../ui/response.js';

const ANALYSIS_INTERVAL_MS = 5000; // Analyze transcription every 5 seconds

/**
 * Toggle Smart Listener mode on/off
 */
export function toggleSmartListener() {
    const newState = !state.smartListenerEnabled;
    setSmartListenerEnabled(newState);

    updateSmartListenerUI(newState);

    if (newState) {
        startSmartListenerAnalysis();
    } else {
        stopSmartListenerAnalysis();
    }
}

/**
 * Update the Smart Listener button UI
 */
export function updateSmartListenerUI(enabled) {
    if (elements.smartListenerBtn) {
        if (enabled) {
            elements.smartListenerBtn.classList.add('active');
        } else {
            elements.smartListenerBtn.classList.remove('active');
        }
    }
}

/**
 * Update the badge count on the Smart Listener button
 */
export function updateSmartListenerBadge(count) {
    if (elements.smartListenerBadge) {
        if (count > 0) {
            elements.smartListenerBadge.textContent = count > 9 ? '9+' : count;
            elements.smartListenerBadge.classList.remove('hidden');
        } else {
            elements.smartListenerBadge.classList.add('hidden');
        }
    }
}

/**
 * Start periodic transcription analysis
 */
function startSmartListenerAnalysis() {
    // Clear any existing interval
    if (state.smartListenerAnalysisInterval) {
        clearInterval(state.smartListenerAnalysisInterval);
    }

    // Reset analysis state on the backend
    window.electronAPI.smartListener.reset();

    const interval = setInterval(async () => {
        if (!state.smartListenerEnabled) return;
        if (!state.fullTranscription || state.fullTranscription.trim().length < 15) return;

        try {
            await window.electronAPI.smartListener.analyze(state.fullTranscription);
        } catch (error) {
            console.error('[SmartListener] Analysis error:', error);
        }
    }, ANALYSIS_INTERVAL_MS);

    setSmartListenerAnalysisInterval(interval);
}

/**
 * Stop periodic transcription analysis
 */
function stopSmartListenerAnalysis() {
    if (state.smartListenerAnalysisInterval) {
        clearInterval(state.smartListenerAnalysisInterval);
        setSmartListenerAnalysisInterval(null);
    }
}

/**
 * Setup Smart Listener IPC event listeners
 */
export function setupSmartListenerEvents() {
    // Listen for new questions detected
    window.electronAPI.smartListener.onNewQuestion((queueItem) => {
        // Update local queue
        state.smartListenerQueue.push(queueItem);

        // Update badge count - show unviewed items that have ready responses
        const unviewedReadyCount = state.smartListenerQueue.filter(q => !q.viewed && q.status === 'ready').length;
        updateSmartListenerBadge(unviewedReadyCount);
    });

    // Listen for responses ready
    window.electronAPI.smartListener.onResponseReady((queueItem) => {
        // Update local queue item
        const idx = state.smartListenerQueue.findIndex(q => q.id === queueItem.id);
        if (idx !== -1) {
            state.smartListenerQueue[idx] = queueItem;
        }

        // Update badge - count unviewed items with ready responses
        const unviewedReadyCount = state.smartListenerQueue.filter(q => !q.viewed && q.status === 'ready').length;
        updateSmartListenerBadge(unviewedReadyCount);

        // Auto-show in response window if smart listener is active
        if (state.smartListenerEnabled && queueItem.status === 'ready') {
            showSmartListenerResponse(queueItem);
        }
    });
}

/**
 * Show a smart listener response in the response window
 */
function showSmartListenerResponse(queueItem) {
    if (!queueItem || !queueItem.response) return;

    // Send to response window with smart-listener flag
    window.electronAPI.showInResponseWindow({
        html: formatResponse(queueItem.response),
        timestamp: new Date(queueItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        prompt: queueItem.question,
        model: 'Smart Listener',
        smartListener: true,
        queueItem: queueItem
    });
}

/**
 * Cleanup when app closes or recording stops
 */
export function cleanupSmartListener() {
    stopSmartListenerAnalysis();
}
