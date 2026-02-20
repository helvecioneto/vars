/**
 * VARS - Smart Listener Module (Main Process)
 * Detects questions and interesting points from transcription text
 * Runs in parallel without blocking the main transcription flow
 */

const { getTierConfig, getModelForTier, getModelListForTier, getRetryConfig, getPromptForLanguage } = require('./config');
const { getValidAccessToken } = require('./providers/openai/codex-auth');

const MAX_CONCURRENT_RESPONSES = 2;   // Máximo de respostas geradas em paralelo
const QUESTION_COOLDOWN_MS = 120000;  // 2 min cooldown para considerar duplicata
const ANALYSIS_DELTA_CHARS = 30;      // Novo limiar de delta (era 20)

// Queue state
let questionQueue = [];       // Array of { id, question, status, response, timestamp, viewed }
let lastAnalyzedText = '';     // Last transcription text that was analyzed
let isAnalyzing = false;       // Prevent concurrent analysis
let questionIdCounter = 0;     // Auto-increment ID
let activeResponsePromises = new Map(); // Track in-flight response generation
let pendingResponseQueue = [];  // Perguntas aguardando slot de geração
let activeResponseCount = 0;    // Quantas gerações estão em andamento

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

// Padrões interrogativos para PT-BR, EN e ES
const QUESTION_PATTERNS = {
    'pt-br': /^(quem|o que|que|qual|quais|quando|onde|como|por que|por quê|pode|poderia|você|é que|será|tem|há|existe|consegue|deveria|devo|devemos|preciso|precisamos|é possível|vale a pena)\b/i,
    'en':    /^(who|what|which|when|where|why|how|can|could|would|should|will|is|are|do|does|did|has|have|may|might|shall|am|isn't|aren't|don't|doesn't|won't|wouldn't|haven't)\b/i,
    'es':    /^(quién|qué|cuál|cuáles|cuándo|dónde|cómo|por qué|puede|podría|es|son|hay|tiene|debería|será|existe|se puede)\b/i
};

/**
 * Detect questions locally using regex — synchronous, no network, < 1ms
 */
function detectQuestionsLocally(transcriptionText, language) {
    if (!transcriptionText || transcriptionText.trim().length < 15) return [];

    const lang = (language || 'en').toLowerCase();
    const pattern = QUESTION_PATTERNS[lang] || QUESTION_PATTERNS['en'];

    // Split into sentences by . ! ? ; or newline
    const sentences = transcriptionText
        .split(/(?<=[.!?;])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => s.length > 8);

    const questions = [];

    for (const sentence of sentences) {
        const clean = sentence.replace(/^["""''`\-–—]+|["""''`\-–—]+$/g, '').trim();
        if (!clean) continue;

        const endsWithQuestion = clean.endsWith('?');
        const startsWithInterrogative = pattern.test(clean);

        if (endsWithQuestion || startsWithInterrogative) {
            const question = endsWithQuestion ? clean : clean + '?';
            if (question.split(/\s+/).length >= 3) {  // Pelo menos 3 palavras
                questions.push(question);
            }
        }
    }

    return questions;
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

    // Only re-analyze if there's at least ANALYSIS_DELTA_CHARS new characters
    if (normalizedText.startsWith(normalizedLast) &&
        normalizedText.length - normalizedLast.length < ANALYSIS_DELTA_CHARS) return;

    isAnalyzing = true;
    lastAnalyzedText = transcriptionText;

    try {
        const questions = detectQuestionsLocally(transcriptionText, config.language);

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

            pendingResponseQueue.push({ item: queueItem, config, callback: onResponseReady });
            processResponseQueue();
        }
    } catch (error) {
        console.error('[SmartListener] Analysis error:', error.message);
    } finally {
        isAnalyzing = false;
    }
}

/**
 * Process the pending response queue, respecting MAX_CONCURRENT_RESPONSES
 */
function processResponseQueue() {
    while (activeResponseCount < MAX_CONCURRENT_RESPONSES && pendingResponseQueue.length > 0) {
        const next = pendingResponseQueue.shift();
        activeResponseCount++;
        generateResponseForItem(next.item, next.config, next.callback)
            .finally(() => {
                activeResponseCount--;
                activeResponsePromises.delete(next.item.id);
                processResponseQueue();
            });
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

const STOPWORDS = new Set([
    'o','a','os','as','um','uma','de','do','da','dos','das','em','no','na',
    'por','para','com','que','se','é','e','ou','mas','como','isso','esse',
    'essa','este','esta','the','an','is','are','was','were','of','in',
    'to','for','with','that','this','it','be','as','at','by','we','he','she'
]);

function normalizeForSimilarity(text) {
    return text.trim().toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .join(' ');
}

/**
 * Check if a question is similar to one already in the queue,
 * using stopword-filtered word overlap and a time-based cooldown.
 */
function isQuestionDuplicate(newQuestion) {
    const normalized = normalizeForSimilarity(newQuestion);
    const now = Date.now();

    return questionQueue.some(item => {
        const itemAge = now - new Date(item.timestamp).getTime();
        if (itemAge > QUESTION_COOLDOWN_MS) return false;

        const existing = normalizeForSimilarity(item.question);
        if (!existing || !normalized) return false;

        if (existing === normalized) return true;
        if (existing.includes(normalized) || normalized.includes(existing)) return true;

        const newWords = new Set(normalized.split(/\s+/).filter(Boolean));
        const existingWords = new Set(existing.split(/\s+/).filter(Boolean));
        if (newWords.size === 0 || existingWords.size === 0) return false;

        const overlap = [...newWords].filter(w => existingWords.has(w)).length;
        const similarity = overlap / Math.max(newWords.size, existingWords.size);
        return similarity > 0.65;
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
    pendingResponseQueue = [];
    activeResponseCount = 0;
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
    generateResponse
};
