/**
 * VARS - API Key Module
 * Handles API key visibility and testing
 */

import { elements } from '../ui/elements.js';

/**
 * Updates the visibility of API Key input fields based on the selected provider.
 * Shows only the relevant API Key field (OpenAI or Google).
 */
export function updateAPIKeyVisibility() {
    const provider = elements.providerSelect?.value || 'openai';
    const openaiKeyGroup = document.getElementById('openai-key-group');
    const googleKeyGroup = document.getElementById('google-key-group');

    if (openaiKeyGroup && googleKeyGroup) {
        if (provider === 'google') {
            openaiKeyGroup.classList.add('hidden');
            googleKeyGroup.classList.remove('hidden');
        } else {
            openaiKeyGroup.classList.remove('hidden');
            googleKeyGroup.classList.add('hidden');
        }
    }
}

/**
 * Tests the API Key connectivity for the current provider.
 * Shows visual feedback for success/failure.
 */
export async function testAPIKey() {
    const testStatus = document.getElementById('api-test-status');
    const provider = elements.providerSelect?.value || 'openai';

    // Get the correct test button based on provider
    const testBtn = provider === 'google'
        ? document.getElementById('test-google-api-btn')
        : document.getElementById('test-api-btn');

    if (!testStatus) return;

    const apiKey = provider === 'google'
        ? elements.googleApiKeyInput?.value?.trim()
        : elements.apiKeyInput?.value?.trim();

    if (!apiKey) {
        testStatus.textContent = 'Please enter an API key first';
        testStatus.className = 'api-test-status error';
        return;
    }

    // Show loading state
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.classList.add('testing');
    }
    testStatus.textContent = 'Testing...';
    testStatus.className = 'api-test-status testing';

    // Get selected tier
    const activeTierBtn = document.querySelector('.tier-btn.active');
    const tier = activeTierBtn?.dataset?.tier || 'balanced';

    try {
        const result = await window.electronAPI.testAPIKey(provider, apiKey, tier);

        if (result.success) {
            testStatus.textContent = '✓ Connection successful';
            testStatus.className = 'api-test-status success';
            if (testBtn) testBtn.classList.add('success');
        } else {
            testStatus.textContent = result.error || 'Connection failed';
            testStatus.className = 'api-test-status error';
        }
    } catch (error) {
        testStatus.textContent = 'Test failed: ' + error.message;
        testStatus.className = 'api-test-status error';
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
        }

        // Clear status after 5 seconds
        setTimeout(() => {
            testStatus.textContent = '';
            testStatus.className = 'api-test-status';
            if (testBtn) testBtn.classList.remove('success');
        }, 5000);
    }
}
