/**
 * VARS - Model Selection Module
 * Handles provider and model tier selection
 */

import { state, PROVIDER_LABELS, TIER_CONFIG } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { autoSaveConfig } from './auto-save.js';

/**
 * Get display label for a provider
 * @param {string} provider - Provider ID
 * @returns {string} Display label
 */
function getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || provider;
}

/**
 * Get display label for a tier
 * @param {string} tier - Tier ID
 * @param {string} provider - Current provider
 * @returns {string} Display label
 */
function getTierLabel(tier, provider = null) {
    return TIER_CONFIG[tier]?.label || tier;
}

/**
 * Get description for a tier
 * @param {string} tier - Tier ID
 * @returns {string} Description
 */
function getTierDescription(tier) {
    return TIER_CONFIG[tier]?.description || '';
}

/**
 * Populate provider selection dropdown
 */
export async function populateProviderOptions() {
    try {
        // Get models configuration from main process
        const modelsConfig = await window.electronAPI.getModels();

        if (elements.providerSelect && modelsConfig?.providers) {
            elements.providerSelect.innerHTML = '';
            Object.keys(modelsConfig.providers).forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = getProviderLabel(provider);
                elements.providerSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load providers configuration:', error);
        // Fallback to default options
        if (elements.providerSelect) {
            elements.providerSelect.innerHTML = `
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
            `;
        }
    }
}

/**
 * Populate model tier buttons based on available tiers and selected provider
 */
export async function populateModelOptions() {
    const tierContainer = document.getElementById('tier-buttons');
    if (!tierContainer) return;

    try {
        // Get models configuration from main process
        const modelsConfig = await window.electronAPI.getModels();
        const tiers = modelsConfig?.tiers || ['fast', 'balanced', 'quality'];

        renderTierButtons(tierContainer, tiers);
    } catch (error) {
        console.error('Failed to load models configuration:', error);
        // Fallback to default tiers
        renderTierButtons(tierContainer, ['fast', 'balanced', 'quality']);
    }
}

/**
 * Render tier selection buttons
 * @param {HTMLElement} container - Button container
 * @param {string[]} tiers - List of available tiers
 */
function renderTierButtons(container, tiers) {
    container.innerHTML = '';
    const currentTier = state.config.tier || 'balanced';
    // Get provider from the select element (current value) rather than config
    // This handles the timing when provider changes but config hasn't been saved yet
    const currentProvider = elements.providerSelect?.value || state.config.provider || 'google';

    // Filter out 'free' tier for providers that don't support it (e.g., OpenAI)
    const filteredTiers = tiers.filter(tier => {
        if (tier === 'free' && currentProvider !== 'google') {
            return false;
        }
        return true;
    });

    filteredTiers.forEach(tier => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tier-btn ${tier === currentTier ? 'active' : ''}`;
        button.dataset.tier = tier;
        button.title = getTierDescription(tier);
        button.textContent = getTierLabel(tier, currentProvider);

        button.addEventListener('click', () => {
            // Update active state
            container.querySelectorAll('.tier-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Save to config
            state.config.tier = tier;
            autoSaveConfig();
            updateModelDisplay();
        });

        container.appendChild(button);
    });
}

/**
 * Update the model status display in the UI
 */
export function updateModelDisplay() {
    const currentTier = state.config.tier || 'balanced';
    if (elements.statusModel) {
        elements.statusModel.textContent = getTierLabel(currentTier, state.config.provider);
        // Reset any retry styling
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
        state.retryResetTimeout = null; // direct set needed as state is imported
    }

    switch (data.status) {
        case 'trying':
            // Show current model being tried with hourglass
            elements.statusModel.textContent = `⏳ ${data.model}`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'retrying':
            // Show retry indicator with attempt number
            elements.statusModel.textContent = `⏳ ${data.model} (${data.attempt}/${data.maxAttempts})`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'switching':
            // Show model switch with arrow
            elements.statusModel.textContent = `⏳ ${data.nextModel}...`;
            elements.statusModel.classList.add('retrying');
            break;

        case 'success':
            // Show success briefly, then reset
            elements.statusModel.textContent = `✓ Free`;
            elements.statusModel.classList.remove('retrying');

            // Reset to normal display after a short delay
            state.retryResetTimeout = setTimeout(() => {
                updateModelDisplay();
            }, 2000);
            break;
    }
}
