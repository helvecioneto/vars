/**
 * VARS - Model Selection Module
 * Handles model display based on quality preset
 */

import { state, TIER_CONFIG } from '../state/index.js';
import { elements } from '../ui/elements.js';

/**
 * Quality preset labels for status display
 */
const PRESET_LABELS = {
    'auth': 'Auth',
    'openai-fast': 'Fast',
    'openai-balanced': 'Balanced',
    'openai-quality': 'Quality',
    'google-free': 'Free',
    'google-fast': 'Fast (G)',
    'google-balanced': 'Balanced (G)',
    'google-quality': 'Quality (G)'
};

/**
 * Update the model status display in the UI
 */
export function updateModelDisplay() {
    const preset = state.config.qualityPreset || 'auth';
    if (elements.statusModel) {
        elements.statusModel.textContent = PRESET_LABELS[preset] || TIER_CONFIG[state.config.tier]?.label || 'Balanced';
        elements.statusModel.classList.remove('retrying');
    }
}

/**
 * Handle free-tier-retry events from main process
 * Shows visual feedback during model retries for free tier
 * @param {object} data - Retry event data
 */
export function handleFreeTierRetry(data) {
    if (!elements.statusModel) return;

    // Clear any pending reset timeout
    if (state.retryResetTimeout) {
        clearTimeout(state.retryResetTimeout);
        state.retryResetTimeout = null;
    }

    switch (data.status) {
        case 'trying':
            elements.statusModel.textContent = `⏳ ${data.model}`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'retrying':
            elements.statusModel.textContent = `⏳ ${data.model} (${data.attempt}/${data.maxAttempts})`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'switching':
            elements.statusModel.textContent = `⏳ ${data.nextModel}...`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'success':
            elements.statusModel.textContent = `✓ Free`;
            elements.statusModel.classList.remove('retrying');
            state.retryResetTimeout = setTimeout(() => {
                updateModelDisplay();
            }, 2000);
            break;
    }
}
