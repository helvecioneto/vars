/**
 * VARS - API Error Handling Module
 * Handles API errors and quota limits
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateStatus } from '../ui/status.js';
import { showResponse } from '../ui/response.js';

/**
 * Show a user-friendly quota error with upgrade option
 */
export function showQuotaError() {
    const message = state.config.language === 'pt-br'
        ? '⚠️ Quota do plano gratuito atingida.\n\nTente novamente mais tarde ou considere usar um plano pago para mais requisições.'
        : state.config.language === 'es'
            ? '⚠️ Cuota del plan gratuito alcanzada.\n\nIntenta de nuevo más tarde o considera usar un plan de pago para más solicitudes.'
            : '⚠️ Free tier quota reached.\n\nPlease try again later or consider upgrading to a paid plan for more requests.';

    showResponse(message);
    updateStatus('Quota limit reached', 'error');

    // Reset the model display
    if (elements.statusModel) {
        elements.statusModel.textContent = 'Free ⚠️';
        elements.statusModel.classList.remove('retrying');
    }
}

/**
 * Handle API result errors, checking for quota errors
 * @param {object} result - API result object
 * @returns {boolean} true if error was handled (caller should return)
 */
export function handleApiError(result) {
    if (result.error) {
        if (result.isQuotaError) {
            showQuotaError();
        } else {
            showResponse(`Error: ${result.error}`);
            updateStatus('Error', 'error');
        }
        return true;
    }
    return false;
}
