/**
 * VARS - Smart Listener Module (Main Process)
 * Detects questions and interesting points from transcription text
 * Runs in parallel without blocking the main transcription flow
 */

const { getTierConfig, getModelForTier, getModelListForTier, getRetryConfig, getPromptForLanguage } = require('./config');
const { getValidAccessToken } = require('./providers/openai/codex-auth');

// Queue state
let questionQueue = [];       // Array of { id, question, status, response, timestamp, viewed }
let lastAnalyzedText = '';     // Last transcription text that was analyzed
let isAnalyzing = false;       // Prevent concurrent analysis
let questionIdCounter = 0;     // Auto-increment ID
let activeResponsePromises = new Map(); // Track in-flight response generation

/**
 * Resolve the API key for the current provider
 */
async function resolveApiKey(config) {
    const provider = config.provider || 'openai';
    if (provider === 'google') {
        return config.googleApiKey || null;
    }
    if (config.useCodexAuth) {
        try {
            const tokenData = await getValidAccessToken();
            if (tokenData && tokenData.accessToken) {
                return tokenData.accessToken;
            }
        } catch (err) {
            console.warn('[SmartListener] Codex auth failed:', err.message);
        }
        return null;
    }
    return config.apiKey || null;
}

/**
 * Analyze transcription text and extract questions/interesting points
 * @param {string} transcriptionText - The current transcription text
 * @param {object} config - App configuration
 * @returns {Promise<string[]>} Array of detected questions
 */
async function detectQuestions(transcriptionText, config) {
    if (!transcriptionText || transcriptionText.trim().length < 15) return [];

    const provider = config.provider || 'openai';
    const apiKey = await resolveApiKey(config);
    if (!apiKey) return [];

    const language = config.language || 'en';
    const tier = config.tier || 'balanced';
    const tierConfig = getTierConfig(provider, tier);
    const model = getModelForTier(provider, tier, 'analyze');

    // Build the detection prompt
    const detectPrompt = buildDetectionPrompt(transcriptionText, language);

    try {
        let responseText;

        if (provider === 'google') {
            const { getGoogleAIResponse } = require('./providers/google');
            const result = await getGoogleAIResponse({
                transcription: detectPrompt,
                params: {
                    apiKey, model,
                    systemPrompt: '',
                    language,
                    history: [],
                    tierConfig,
                    briefMode: true
                }
            });
            responseText = result.response;
        } else {
            const { getChatCompletionResponse } = require('./providers/openai/chat');
            responseText = await getChatCompletionResponse(
                detectPrompt,
                apiKey,
                model,
                '', // no system prompt
                language,
                [], // no history
                tierConfig,
                true // brief mode
            );
        }

        // Parse the response - expect JSON array of strings
        return parseDetectedQuestions(responseText);
    } catch (error) {
        console.error('[SmartListener] Detection error:', error.message);
        return [];
    }
}

/**
 * Build the question detection prompt
 */
function buildDetectionPrompt(text, language) {
    const prompts = {
        'en': `Analyze the following transcription and extract ONLY the questions or key points that would benefit from an AI answer. Return ONLY a JSON array of strings. If there are no questions, return an empty array []. Do not include greetings, filler words, or non-questions. Each item should be a clear, self-contained question.

Transcription:
"${text}"

Return ONLY the JSON array, nothing else. Example: ["What is X?", "How does Y work?"]`,

        'pt-br': `Analise a seguinte transcrição e extraia APENAS as perguntas ou pontos-chave que se beneficiariam de uma resposta de IA. Retorne APENAS um array JSON de strings. Se não houver perguntas, retorne um array vazio []. Não inclua cumprimentos, palavras de preenchimento ou não-perguntas. Cada item deve ser uma pergunta clara e autossuficiente.

Transcrição:
"${text}"

Retorne APENAS o array JSON, nada mais. Exemplo: ["O que é X?", "Como Y funciona?"]`,

        'es': `Analiza la siguiente transcripción y extrae SOLO las preguntas o puntos clave que se beneficiarían de una respuesta de IA. Devuelve SOLO un array JSON de strings. Si no hay preguntas, devuelve un array vacío []. No incluyas saludos, palabras de relleno o no-preguntas. Cada elemento debe ser una pregunta clara y autosuficiente.

Transcripción:
"${text}"

Devuelve SOLO el array JSON, nada más. Ejemplo: ["¿Qué es X?", "¿Cómo funciona Y?"]`
    };

    return prompts[language] || prompts['en'];
}

/**
 * Parse the AI response to extract questions
 */
function parseDetectedQuestions(responseText) {
    if (!responseText) return [];

    try {
        // Try to find JSON array in the response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
                return parsed.filter(q => typeof q === 'string' && q.trim().length > 0);
            }
        }
    } catch (e) {
        console.warn('[SmartListener] Failed to parse JSON response:', e.message);
    }

    // Fallback: try to extract questions line by line
    const lines = responseText.split('\n').filter(l => l.trim().length > 0);
    return lines
        .map(l => l.replace(/^[\d\-\.\*\)]+\s*/, '').replace(/^["']|["']$/g, '').trim())
        .filter(l => l.length > 5 && (l.includes('?') || l.length > 10));
}

/**
 * Generate AI response for a specific question
 * @param {string} question - The question to answer
 * @param {object} config - App configuration
 * @returns {Promise<string>} The AI response
 */
async function generateResponse(question, config) {
    const provider = config.provider || 'openai';
    const apiKey = await resolveApiKey(config);
    if (!apiKey) throw new Error('API key not available');

    const tier = config.tier || 'balanced';
    const tierConfig = getTierConfig(provider, tier);
    const model = getModelForTier(provider, tier, 'analyze');

    if (provider === 'google') {
        const { getGoogleAIResponse } = require('./providers/google');
        const result = await getGoogleAIResponse({
            transcription: question,
            params: {
                apiKey, model,
                systemPrompt: config.systemPrompt || '',
                language: config.language || 'en',
                history: config.conversationHistory || [],
                tierConfig,
                briefMode: config.briefMode || false,
                fileSearchStoreName: config.fileSearchStoreName || null
            }
        });
        return result.response;
    } else {
        const { getSmartAIResponse } = require('./providers/openai');
        const result = await getSmartAIResponse({
            transcription: question,
            params: {
                apiKey, model,
                systemPrompt: config.systemPrompt || '',
                language: config.language || 'en',
                history: config.conversationHistory || [],
                assistantId: config.assistantId,
                vectorStoreId: config.vectorStoreId,
                threadId: config.threadId,
                knowledgeBasePaths: config.knowledgeBasePaths || [],
                briefMode: config.briefMode || false,
                tierConfig
            }
        });
        return result.response;
    }
}

/**
 * Main analysis function - called periodically with new transcription text
 * Runs in a non-blocking way
 * @param {string} transcriptionText - Current transcription
 * @param {object} config - App configuration
 * @param {function} onNewQuestion - Callback when new question is added to queue
 * @param {function} onResponseReady - Callback when a response is generated
 */
async function analyzeTranscription(transcriptionText, config, onNewQuestion, onResponseReady) {
    // Skip if already analyzing or text hasn't changed enough
    if (isAnalyzing) return;
    if (!transcriptionText || transcriptionText.trim().length < 15) return;

    // Check if text has meaningfully changed since last analysis
    const normalizedText = transcriptionText.trim().toLowerCase();
    const normalizedLast = lastAnalyzedText.trim().toLowerCase();

    if (normalizedText === normalizedLast) return;

    // Only re-analyze if there's at least 20 new characters
    if (normalizedText.startsWith(normalizedLast) &&
        normalizedText.length - normalizedLast.length < 20) return;

    isAnalyzing = true;
    lastAnalyzedText = transcriptionText;

    try {
        const questions = await detectQuestions(transcriptionText, config);

        if (questions.length === 0) {
            return;
        }

        // Filter out questions already in the queue (by similarity)
        const newQuestions = questions.filter(q => !isQuestionDuplicate(q));

        for (const question of newQuestions) {
            const queueItem = {
                id: ++questionIdCounter,
                question: question,
                status: 'pending', // 'pending' | 'generating' | 'ready' | 'error'
                response: null,
                timestamp: new Date().toISOString(),
                viewed: false
            };

            questionQueue.push(queueItem);

            // Notify about new question
            if (onNewQuestion) onNewQuestion(queueItem);

            // Generate response in parallel (fire and forget)
            const responsePromise = generateResponseForItem(queueItem, config, onResponseReady);
            activeResponsePromises.set(queueItem.id, responsePromise);
        }
    } catch (error) {
        console.error('[SmartListener] Analysis error:', error.message);
    } finally {
        isAnalyzing = false;
    }
}

/**
 * Generate response for a queue item
 */
async function generateResponseForItem(queueItem, config, onResponseReady) {
    queueItem.status = 'generating';

    try {
        const response = await generateResponse(queueItem.question, config);
        queueItem.response = response;
        queueItem.status = 'ready';

        if (onResponseReady) onResponseReady(queueItem);
    } catch (error) {
        console.error(`[SmartListener] Response error for Q${queueItem.id}:`, error.message);
        queueItem.status = 'error';
        queueItem.response = `Error: ${error.message}`;

        if (onResponseReady) onResponseReady(queueItem);
    } finally {
        activeResponsePromises.delete(queueItem.id);
    }
}

/**
 * Check if a question is similar to one already in the queue
 */
function isQuestionDuplicate(newQuestion) {
    const normalized = newQuestion.trim().toLowerCase();

    return questionQueue.some(item => {
        const existing = item.question.trim().toLowerCase();
        // Exact match
        if (existing === normalized) return true;
        // High similarity (one contains the other)
        if (existing.includes(normalized) || normalized.includes(existing)) return true;
        // Simple word overlap check
        const newWords = new Set(normalized.split(/\s+/));
        const existingWords = new Set(existing.split(/\s+/));
        const overlap = [...newWords].filter(w => existingWords.has(w)).length;
        const similarity = overlap / Math.max(newWords.size, existingWords.size);
        return similarity > 0.7;
    });
}

/**
 * Get the current question queue
 */
function getQueue() {
    return [...questionQueue];
}

/**
 * Mark a question as viewed
 */
function markViewed(questionId) {
    const item = questionQueue.find(q => q.id === questionId);
    if (item) item.viewed = true;
}

/**
 * Mark all questions as viewed
 */
function markAllViewed() {
    questionQueue.forEach(q => q.viewed = true);
}

/**
 * Get count of unviewed questions with ready responses
 */
function getUnviewedCount() {
    return questionQueue.filter(q => !q.viewed && q.status === 'ready').length;
}

/**
 * Clear the question queue
 */
function clearQueue() {
    questionQueue = [];
    lastAnalyzedText = '';
    questionIdCounter = 0;
    activeResponsePromises.clear();
}

/**
 * Reset the analyzer state (when recording stops/starts)
 */
function resetAnalysis() {
    lastAnalyzedText = '';
    isAnalyzing = false;
}

module.exports = {
    analyzeTranscription,
    getQueue,
    markViewed,
    markAllViewed,
    getUnviewedCount,
    clearQueue,
    resetAnalysis,
    detectQuestions,
    generateResponse
};
