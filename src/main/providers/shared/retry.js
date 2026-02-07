/**
 * VARS - Shared Retry and Fallback Utilities
 * Used by both Google and OpenAI providers
 */

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (rate limit, temporary failure)
 * @param {Error} error - The error to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(error) {
    const message = error?.message?.toLowerCase() || '';
    const status = error?.status || error?.statusCode || error?.code;

    return (
        status === 429 ||
        status === 503 ||
        status === 'RESOURCE_EXHAUSTED' ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('resource_exhausted') ||
        message.includes('temporarily unavailable') ||
        message.includes('429') ||
        message.includes('too many requests')
    );
}

/**
 * Execute an operation with retry and model fallback
 * @param {Function} operation - Async function that takes a model name and returns result
 * @param {string[]} models - Array of model names to try in order
 * @param {object} retryConfig - Retry configuration
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {*} Result from the first successful operation
 */
async function executeWithFallback(operation, models, retryConfig, onProgress = null) {
    const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = retryConfig;
    let lastError;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        const model = models[modelIndex];
        const shortName = model.replace('gemini-', '').replace('-preview', '');

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[FREE-TIER] Trying model: ${model} (attempt ${attempt + 1}/${maxRetries + 1})`);

                if (onProgress) {
                    onProgress({
                        status: 'trying',
                        model: shortName,
                        modelIndex: modelIndex + 1,
                        totalModels: models.length,
                        attempt: attempt + 1,
                        maxAttempts: maxRetries + 1
                    });
                }

                const result = await operation(model);
                console.log(`[FREE-TIER] Success with model: ${model}`);

                if (onProgress) {
                    onProgress({ status: 'success', model: shortName });
                }

                return result;
            } catch (error) {
                lastError = error;
                console.error(`[FREE-TIER] Error on ${model}:`, error.message);

                if (!isRetryableError(error)) {
                    console.log(`[FREE-TIER] Non-retryable error, trying next model...`);
                    break;
                }

                if (attempt < maxRetries) {
                    const delay = Math.min(
                        initialDelayMs * Math.pow(backoffMultiplier, attempt),
                        maxDelayMs
                    );
                    console.log(`[FREE-TIER] Rate limited on ${model}, retrying in ${delay}ms...`);

                    if (onProgress) {
                        onProgress({
                            status: 'retrying',
                            model: shortName,
                            attempt: attempt + 1,
                            maxAttempts: maxRetries + 1,
                            delayMs: delay
                        });
                    }

                    await sleep(delay);
                } else {
                    console.log(`[FREE-TIER] Max retries reached for ${model}, trying next model...`);

                    if (onProgress && modelIndex < models.length - 1) {
                        onProgress({
                            status: 'switching',
                            model: shortName,
                            nextModel: models[modelIndex + 1].replace('gemini-', '').replace('-preview', '')
                        });
                    }
                }
            }
        }
    }

    // All models exhausted
    const quotaError = new Error('FREE_QUOTA_EXHAUSTED');
    quotaError.isQuotaError = true;
    quotaError.userMessage = 'Quota do plano gratuito atingida. Tente novamente mais tarde ou considere usar um plano pago para mais requisições.';
    throw quotaError;
}

module.exports = { sleep, isRetryableError, executeWithFallback };
