/**
 * VARS - Codex Responses API
 * 
 * Handles communication with the ChatGPT Codex backend API.
 * Used when authenticating via Codex CLI OAuth (ChatGPT Plus/Pro subscription).
 * 
 * Codex OAuth tokens CANNOT use the standard OpenAI Chat Completions API at api.openai.com.
 * They must use the Codex Responses API at chatgpt.com/backend-api/codex/responses.
 * 
 * Reference: pi-ai openai-codex-responses.ts
 */

const os = require('os');

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

// Model mapping: standard OpenAI models → Codex-compatible equivalents
// Codex OAuth only supports GPT-5.x models through the ChatGPT backend
const MODEL_MAP = {
    'gpt-4o-mini': 'gpt-5.1-codex-mini',
    'gpt-4o': 'gpt-5.1',
    'gpt-4': 'gpt-5.1',
    'gpt-4-turbo': 'gpt-5.1',
    'gpt-4-turbo-preview': 'gpt-5.1',
    'gpt-4o-2024-05-13': 'gpt-5.1',
    'gpt-4o-2024-08-06': 'gpt-5.1',
    'gpt-4o-2024-11-20': 'gpt-5.1',
    'gpt-4o-mini-2024-07-18': 'gpt-5.1-codex-mini',
};

/**
 * Extract ChatGPT Account ID from a JWT token
 * @param {string} token - JWT access token
 * @returns {string|null} Account ID or null
 */
function extractAccountId(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return payload[JWT_CLAIM_PATH]?.chatgpt_account_id ||
            payload[JWT_CLAIM_PATH]?.account_id ||
            null;
    } catch {
        return null;
    }
}

/**
 * Map standard model names to Codex-compatible equivalents
 * @param {string} model - Model name
 * @returns {string} Codex-compatible model name
 */
function resolveCodexModel(model) {
    return MODEL_MAP[model] || model;
}

/**
 * Build request headers for Codex API
 * Headers are based on pi-ai's buildHeaders() in openai-codex-responses.ts
 * @param {string} accountId - ChatGPT account ID
 * @param {string} token - OAuth access token
 * @returns {object} Headers object
 */
function buildHeaders(accountId, token) {
    return {
        'Authorization': `Bearer ${token}`,
        'chatgpt-account-id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'vars',
        'User-Agent': `vars (${os.platform()} ${os.release()}; ${os.arch()})`,
        'accept': 'text/event-stream',
        'content-type': 'application/json',
    };
}

/**
 * Convert Chat Completions messages to Responses API input format
 * System messages are excluded (they go in the 'instructions' field)
 * @param {Array} messages - Chat Completions format messages
 * @returns {Array} Responses API input array
 */
function convertToResponsesInput(messages) {
    return messages
        .filter(m => m.role !== 'system')
        .map(m => {
            // Handle multimodal content (images)
            if (Array.isArray(m.content)) {
                const parts = m.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'input_text', text: part.text };
                    }
                    if (part.type === 'image_url') {
                        return { type: 'input_image', image_url: part.image_url?.url || part.image_url };
                    }
                    return { type: 'input_text', text: JSON.stringify(part) };
                });
                return { role: m.role, content: parts };
            }
            // Simple text content
            return { role: m.role, content: m.content };
        });
}

/**
 * Build the request body for Codex Responses API
 * Body format based on pi-ai's buildRequestBody() in openai-codex-responses.ts
 * @param {string} model - Model name (already resolved)
 * @param {string} systemPrompt - System prompt / instructions
 * @param {Array} input - Converted input messages
 * @param {number} maxOutputTokens - Maximum output tokens
 * @returns {object} Request body
 */
function buildRequestBody(model, systemPrompt, input, maxOutputTokens) {
    const body = {
        model: model,
        store: false,
        stream: true,
        instructions: systemPrompt || 'You are a helpful assistant.',
        input: input,
    };

    return body;
}

/**
 * Parse SSE (Server-Sent Events) response and extract text content
 * SSE parsing based on pi-ai's parseSSE() in openai-codex-responses.ts
 * @param {Response} response - Fetch Response with SSE body
 * @returns {Promise<string>} Extracted text content
 */
async function parseSSEResponse(response) {
    const text = await response.text();
    let result = '';

    // SSE events are separated by double newlines
    const events = text.split('\n\n');
    for (const event of events) {
        const dataLines = event.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trim());

        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n').trim();
        if (!data || data === '[DONE]') continue;

        try {
            const parsed = JSON.parse(data);

            // Collect text deltas
            if (parsed.type === 'response.output_text.delta') {
                result += parsed.delta || '';
            }

            // Handle errors from Codex backend
            if (parsed.type === 'error') {
                const msg = parsed.message || parsed.code || JSON.stringify(parsed);
                throw new Error(`Codex API error: ${msg}`);
            }

            if (parsed.type === 'response.failed') {
                const msg = parsed.response?.error?.message || 'Codex response failed';
                throw new Error(msg);
            }
        } catch (e) {
            // Re-throw Codex/application errors, ignore JSON parse errors from partial data
            if (e.message && (e.message.startsWith('Codex') || e.message === 'Codex response failed')) {
                throw e;
            }
        }
    }

    return result;
}

/**
 * Get a response from the Codex Responses API
 * 
 * This function handles the full flow:
 * 1. Extract account ID from JWT token
 * 2. Map model name to Codex-compatible equivalent
 * 3. Convert messages to Responses API format
 * 4. Call chatgpt.com/backend-api/codex/responses
 * 5. Parse SSE response stream
 * 6. Return text content
 * 
 * @param {string} token - OAuth access token (JWT)
 * @param {string} model - Model name (will be auto-mapped if not Codex compatible)
 * @param {string} systemPrompt - System prompt / instructions
 * @param {Array} messages - Chat messages in Chat Completions format
 * @param {number} maxOutputTokens - Maximum output tokens
 * @returns {Promise<string>} Response text
 */
async function getCodexResponse(token, model, systemPrompt, messages, maxOutputTokens) {
    const accountId = extractAccountId(token);
    if (!accountId) {
        throw new Error('Failed to extract account ID from OAuth token. Please re-login with Codex CLI.');
    }

    const resolvedModel = resolveCodexModel(model);
    const input = convertToResponsesInput(messages);
    const headers = buildHeaders(accountId, token);
    const body = buildRequestBody(resolvedModel, systemPrompt, input, maxOutputTokens);

    if (model !== resolvedModel) {
        console.log(`[Codex Responses] Model mapped: ${model} → ${resolvedModel}`);
    }
    console.log(`[Codex Responses] Calling ${CODEX_URL} with model ${resolvedModel}`);

    const response = await fetch(CODEX_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Codex Responses] Error ${response.status}:`, errorText);

        let errorMessage;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.detail?.message || errorJson.detail || errorJson.message || errorText;
        } catch {
            errorMessage = errorText;
        }

        throw new Error(`Codex API error (${response.status}): ${errorMessage}`);
    }

    const result = await parseSSEResponse(response);

    if (!result) {
        throw new Error('Codex API returned empty response');
    }

    console.log(`[Codex Responses] Success, response length: ${result.length} chars`);
    return result;
}

/**
 * List of Codex-compatible models available through chatgpt.com
 */
const CODEX_MODELS = [
    'gpt-5.1',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex-max',
    'gpt-5.2',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
];

/**
 * Check if a model name is Codex-compatible (GPT-5.x family)
 * @param {string} model - Model name
 * @returns {boolean}
 */
function isCodexCompatibleModel(model) {
    return CODEX_MODELS.includes(model) || model.startsWith('gpt-5');
}

/**
 * Transcribe audio using the Codex Responses API
 * Instead of Whisper (which requires an API key), this uses GPT-5.x
 * multimodal capabilities to transcribe audio via the ChatGPT backend.
 * 
 * @param {string} token - OAuth access token (JWT)
 * @param {Buffer} audioBuffer - Audio data buffer
 * @param {string} language - Language code (default: 'pt')
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeWithCodex(token, audioBuffer, language = 'pt') {
    const accountId = extractAccountId(token);
    if (!accountId) {
        throw new Error('Failed to extract account ID from OAuth token. Please re-login with Codex CLI.');
    }

    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // Detect audio format from header
    let format = 'webm';
    if (buffer.length > 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
        format = 'wav';
    }

    const base64Audio = buffer.toString('base64');
    const model = 'gpt-5.1-codex-mini'; // Use mini for speed

    const languageNames = {
        'pt': 'Portuguese',
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
    };
    const langName = languageNames[language] || language;

    const mimeType = format === 'wav' ? 'audio/wav' : 'audio/webm';

    const input = [
        {
            role: 'user',
            content: [
                {
                    type: 'input_file',
                    file_data: `data:${mimeType};base64,${base64Audio}`,
                },
                {
                    type: 'input_text',
                    text: `Transcribe ALL the spoken words in this audio COMPLETELY, word for word in ${langName}. Do NOT summarize or shorten. Return ONLY the transcription text, nothing else.`,
                },
            ],
        },
    ];

    const headers = buildHeaders(accountId, token);
    const body = {
        model: model,
        store: false,
        stream: true,
        instructions: 'You are a transcription assistant. Output only the exact transcribed text from the audio, nothing else.',
        input: input,
    };

    console.log(`[Codex Transcription] Transcribing audio (${buffer.length} bytes, format: ${format}) with ${model}`);

    const response = await fetch(CODEX_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Codex Transcription] Error ${response.status}:`, errorText);

        let errorMessage;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.detail?.message || errorJson.detail || errorJson.message || errorText;
        } catch {
            errorMessage = errorText;
        }

        throw new Error(`Codex transcription error (${response.status}): ${errorMessage}`);
    }

    const result = await parseSSEResponse(response);

    if (!result) {
        throw new Error('Codex transcription returned empty response');
    }

    console.log(`[Codex Transcription] Success, transcription length: ${result.length} chars`);
    return result;
}

module.exports = {
    getCodexResponse,
    transcribeWithCodex,
    resolveCodexModel,
    extractAccountId,
    isCodexCompatibleModel,
    CODEX_MODELS,
};
