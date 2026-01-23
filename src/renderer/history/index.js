/**
 * VARS - History Module
 * Handles conversation history navigation and display
 */

import { state, setHistoryIndex } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { showTranscription, showResponse } from '../ui/response.js';
import { updateStatus } from '../ui/status.js';
import { autoSaveConfig } from '../settings/auto-save.js';

/**
 * Navigate through conversation history
 * @param {string} direction - 'up' (back in time) or 'down' (forward in time)
 */
export function navigateHistory(direction) {
    const history = state.config.conversationHistory || [];
    const pairCount = Math.floor(history.length / 2);

    if (pairCount === 0) return;

    // Mapping logic:
    // -1: Live view
    // 0: Oldest pair
    // pairCount - 1: Newest pair

    if (direction === 'up') {
        // Moving back in time (or looping)
        if (state.historyIndex === -1) {
            setHistoryIndex(pairCount - 1); // Start at newest history
        } else if (state.historyIndex === 0) {
            setHistoryIndex(pairCount - 1); // Loop to newest
        } else {
            setHistoryIndex(state.historyIndex - 1);
        }
    } else if (direction === 'down') {
        // Moving forward in time
        if (state.historyIndex === -1) {
            setHistoryIndex(0); // Loop to oldest
        } else if (state.historyIndex === pairCount - 1) {
            setHistoryIndex(-1); // Back to live
        } else {
            setHistoryIndex(state.historyIndex + 1);
        }
    }

    displayHistoryItem();
}

/**
 * Display the current history item
 */
export function displayHistoryItem() {
    if (state.historyIndex === -1) {
        // Show empty/live state
        showTranscription('');
        showResponse('');
        updateStatus('Ready (Live)', 'ready');
        if (elements.inputField) elements.inputField.value = '';
    } else {
        const history = state.config.conversationHistory || [];
        // Index i corresponds to pairs at 2*i and 2*i+1
        const userMsg = history[state.historyIndex * 2];
        const aiMsg = history[state.historyIndex * 2 + 1];

        if (userMsg && aiMsg) {
            showTranscription(userMsg.content);
            showResponse(aiMsg.content);
            const clearBtnHtml = ` <span id="clear-history-btn" style="cursor:pointer; text-decoration:underline; margin-left:10px; opacity:0.7; font-size:0.9em;">(Clear)</span>`;
            updateStatus(`History ${state.historyIndex + 1}/${Math.floor(history.length / 2)}${clearBtnHtml}`, 'ready');
        }
    }
}

/**
 * Clear all conversation history
 */
export function clearHistory() {
    state.config.conversationHistory = [];
    autoSaveConfig();
    setHistoryIndex(-1);
    displayHistoryItem();
    updateStatus('History Cleared', 'ready');

    // Brief timeout to return to "Ready"
    setTimeout(() => {
        updateStatus('Ready', 'ready');
    }, 2000);
}

/**
 * Update history with a new user-AI exchange
 * @param {string} userText - User's message/transcription
 * @param {string} aiResponse - AI's response
 */
export function updateHistory(userText, aiResponse) {
    state.config.conversationHistory = state.config.conversationHistory || [];

    // Add new pair
    state.config.conversationHistory.push({ role: 'user', content: userText });
    state.config.conversationHistory.push({ role: 'assistant', content: aiResponse });

    // Keep only last 3 pairs (6 items)
    if (state.config.conversationHistory.length > 6) {
        state.config.conversationHistory = state.config.conversationHistory.slice(-6);
    }

    // Save
    autoSaveConfig();

    // Reset to live view
    setHistoryIndex(-1);
}
