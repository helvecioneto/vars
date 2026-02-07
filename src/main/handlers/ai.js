/**
 * VARS - AI IPC Handlers
 * Handles AI responses, image analysis, and knowledge base
 */

const { ipcMain } = require('electron');
const { saveConfig, getTierConfig, getModelForTier, getModelListForTier, getRetryConfig } = require('../config');
const {
    getSmartAIResponse,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase,
    analyzeImageOpenAI
} = require('../providers/openai');
const {
    getGoogleAIResponse,
    analyzeImageGoogle,
    createGoogleKnowledgeBase,
    resetGoogleKnowledgeBase
} = require('../providers/google');

/**
 * Setup AI-related IPC handlers
 * @param {object} context - Context with getMainWindow, getConfig, setConfig
 */
function setupAIHandlers(context) {
    const { getMainWindow, getConfig, setConfig } = context;

    // Get AI response
    ipcMain.handle('get-ai-response', async (event, transcription) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const tierConfig = getTierConfig(provider, tier);
            let result;

            if (provider === 'google') {
                if (tier === 'free') {
                    const modelList = getModelListForTier(provider, tier, 'analyze');
                    const retryConfig = getRetryConfig(provider, tier);
                    const onProgress = (data) => {
                        const mainWindow = getMainWindow();
                        if (mainWindow) {
                            mainWindow.webContents.send('free-tier-retry', { type: 'analyze', ...data });
                        }
                    };

                    result = await getGoogleAIResponse({
                        transcription,
                        params: {
                            apiKey, models: modelList, retryConfig, onProgress,
                            systemPrompt: config.systemPrompt,
                            language: config.language || 'en',
                            history: config.conversationHistory || [],
                            tierConfig, briefMode: config.briefMode || false,
                            fileSearchStoreName: config.fileSearchStoreName || null
                        }
                    });
                } else {
                    const analyzeModel = getModelForTier(provider, tier, 'analyze');
                    result = await getGoogleAIResponse({
                        transcription,
                        params: {
                            apiKey, model: analyzeModel,
                            systemPrompt: config.systemPrompt,
                            language: config.language || 'en',
                            history: config.conversationHistory || [],
                            tierConfig, briefMode: config.briefMode || false,
                            fileSearchStoreName: config.fileSearchStoreName || null
                        }
                    });
                }
            } else {
                const analyzeModel = getModelForTier(provider, tier, 'analyze');
                result = await getSmartAIResponse({
                    transcription,
                    params: {
                        apiKey, model: analyzeModel,
                        systemPrompt: config.systemPrompt,
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

                if (result.threadId && result.threadId !== config.threadId) {
                    config.threadId = result.threadId;
                    setConfig(config);
                    saveConfig(config);
                }
            }

            return { response: result.response };
        } catch (error) {
            console.error('AI Response Error:', error);
            if (error.isQuotaError) {
                return { error: error.userMessage, isQuotaError: true };
            }
            return { error: error.message };
        }
    });

    // Knowledge Base - create
    ipcMain.handle('knowledge-base:create', async () => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        if (!config.knowledgeBasePaths || config.knowledgeBasePaths.length === 0) {
            return { error: 'No files to process' };
        }

        try {
            if (provider === 'google') {
                const fileSearchStoreName = await createGoogleKnowledgeBase(
                    apiKey, config.knowledgeBasePaths, config.fileSearchStoreName
                );
                config.fileSearchStoreName = fileSearchStoreName;
                console.log('[KB] Created Google File Search Store:', fileSearchStoreName);
            } else {
                const assistant = await initializeAssistant(apiKey, config.assistantId);
                config.assistantId = assistant.id;
                const vectorStoreId = await createKnowledgeBase(apiKey, config.knowledgeBasePaths, config.vectorStoreId);
                config.vectorStoreId = vectorStoreId;
                await updateAssistantVectorStore(apiKey, config.assistantId, vectorStoreId);
            }

            setConfig(config);
            await saveConfig(config);
            return { success: true, count: config.knowledgeBasePaths.length };
        } catch (error) {
            console.error('KB Create Error:', error);
            return { error: error.message };
        }
    });

    // Knowledge Base - reset
    ipcMain.handle('knowledge-base:reset', async () => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };

        try {
            if (provider === 'google') {
                await resetGoogleKnowledgeBase(apiKey, config.fileSearchStoreName);
                config.fileSearchStoreName = null;
                config.conversationHistory = [];
                console.log('[KB] Reset Google File Search Store and History');
            } else {
                await resetKnowledgeBase(apiKey, config.vectorStoreId);
                config.vectorStoreId = null;
                config.threadId = null;
            }

            setConfig(config);
            await saveConfig(config);
            return { success: true };
        } catch (error) {
            console.error('KB Reset Error:', error);
            return { error: error.message };
        }
    });

    // Analyze image
    ipcMain.handle('analyze-image', async (event, { imageData, prompt, windowTitle }) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const tierConfig = getTierConfig(provider, tier);

            let contextualPrompt;
            if (prompt && prompt.trim()) {
                contextualPrompt = windowTitle ? `[Screenshot: ${windowTitle}]\n\n${prompt}` : prompt;
            } else {
                contextualPrompt = `Analyze this screenshot${windowTitle ? ` from "${windowTitle}"` : ''}.
Look at everything visible and:
1. If there are questions, exercises, or problems visible, provide the answers or solutions
2. If there's code, explain what it does and identify any issues
3. If there's an error message, explain what it means and how to fix it
4. If there's text content, summarize the key information
5. If there's a form or interface, describe what actions can be taken
Be direct and helpful. Focus on actionable information.`;
            }

            let response;
            const analyzeModel = getModelForTier(provider, tier, 'analyze');

            if (provider === 'google') {
                response = await analyzeImageGoogle({
                    imageData, prompt: contextualPrompt, apiKey, model: analyzeModel,
                    systemPrompt: config.systemPrompt, language: config.language || 'en',
                    history: config.conversationHistory || [], tierConfig,
                    briefMode: config.briefMode || false
                });
            } else {
                response = await analyzeImageOpenAI({
                    imageData, prompt: contextualPrompt, apiKey, model: analyzeModel,
                    systemPrompt: config.systemPrompt, language: config.language || 'en',
                    history: config.conversationHistory || [], tierConfig,
                    briefMode: config.briefMode || false
                });
            }

            return { response };
        } catch (error) {
            console.error('[Image Analysis] Error:', error);
            return { error: error.message };
        }
    });

    // Optimize System Prompt using AI
    ipcMain.handle('optimize-prompt', async (event, userInput) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        if (!userInput || !userInput.trim()) {
            return { error: 'Please enter a prompt to optimize' };
        }

        try {
            const { getPromptForLanguage } = require('../config');
            const language = config.language || 'en';

            // Get optimizer instruction in the selected language
            let optimizerPrompt = getPromptForLanguage('optimizer.instruction', language);
            optimizerPrompt = optimizerPrompt.replace('{userInput}', userInput.trim());

            const tier = config.tier || 'balanced';
            const tierConfig = getTierConfig(provider, tier);
            const analyzeModel = getModelForTier(provider, tier, 'analyze');

            let result;
            if (provider === 'google') {
                result = await getGoogleAIResponse({
                    transcription: optimizerPrompt,
                    params: {
                        apiKey,
                        model: analyzeModel,
                        systemPrompt: '',
                        language,
                        history: [],
                        tierConfig,
                        briefMode: false
                    }
                });
            } else {
                const { getChatCompletionResponse } = require('../providers/openai/chat');
                const response = await getChatCompletionResponse(
                    optimizerPrompt,
                    apiKey,
                    analyzeModel,
                    '', // systemPrompt
                    language,
                    [], // history
                    tierConfig,
                    false // briefMode
                );
                result = { response };
            }

            return { optimizedPrompt: result.response };
        } catch (error) {
            console.error('[Prompt Optimizer] Error:', error);
            return { error: error.message };
        }
    });
}

module.exports = { setupAIHandlers };
