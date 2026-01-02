const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Load centralized configuration files
const models = require('../config/models.json');
const prompts = require('../config/prompts.json');

const CONFIG_DIR = path.join(os.homedir(), '.vars');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Helper functions to access models and prompts
function getModels() {
    return models;
}

function getPrompts() {
    return prompts;
}

/**
 * Get available tiers
 */
function getTiers() {
    return models.tiers || ['fast', 'balanced', 'quality'];
}

/**
 * Get available providers
 */
function getProviders() {
    return Object.keys(models.providers || { openai: {} });
}

/**
 * Get model configuration for a specific provider, tier, and type
 * @param {string} provider - 'openai' or 'google'
 * @param {string} tier - 'fast', 'balanced', or 'quality'
 * @param {string} type - 'analyze' or 'transcribe'
 * @returns {string} Model name
 */
function getModelForTier(provider = 'openai', tier = 'balanced', type = 'analyze') {
    const providerConfig = models.providers?.[provider];
    if (!providerConfig) {
        console.warn(`Provider not found: ${provider}, falling back to openai`);
        return models.providers?.openai?.[tier]?.[type] || 'gpt-4o';
    }

    const tierConfig = providerConfig[tier];
    if (!tierConfig) {
        console.warn(`Tier not found: ${tier}, falling back to balanced`);
        return providerConfig.balanced?.[type] || 'gpt-4o';
    }

    return tierConfig[type] || 'gpt-4o';
}

/**
 * Get full tier configuration with all parameters
 * @param {string} provider - 'openai' or 'google'
 * @param {string} tier - 'fast', 'balanced', or 'quality'
 * @returns {object} Full tier config including temperature, maxOutputTokens, etc.
 */
function getTierConfig(provider = 'openai', tier = 'balanced') {
    const providerConfig = models.providers?.[provider];
    if (!providerConfig) {
        return models.providers?.openai?.balanced || {};
    }
    return providerConfig[tier] || providerConfig.balanced || {};
}

/**
 * Get special model (realtime, assistant) for a provider
 * @param {string} provider - 'openai' or 'google'
 * @param {string} type - 'realtime' or 'assistant'
 * @returns {string} Model name
 */
function getSpecialModel(provider = 'openai', type = 'realtime') {
    return models.providers?.[provider]?.[type] || null;
}

/**
 * Get model list for fallback (for tiers with multiple models like 'free')
 * @param {string} provider - 'openai' or 'google'
 * @param {string} tier - tier name
 * @param {string} type - 'analyze' or 'transcribe'
 * @returns {string[]} List of models in priority order
 */
function getModelListForTier(provider = 'google', tier = 'free', type = 'analyze') {
    const tierConfig = models.providers?.[provider]?.[tier];
    if (!tierConfig) return [];

    const modelValue = tierConfig[type];

    // If it's an array, return as-is; if string, wrap in array
    return Array.isArray(modelValue) ? modelValue : [modelValue];
}

/**
 * Get retry configuration for a tier
 * @param {string} provider - 'openai' or 'google'
 * @param {string} tier - tier name
 * @returns {object} Retry configuration with maxRetries, delays, etc.
 */
function getRetryConfig(provider = 'google', tier = 'free') {
    const tierConfig = models.providers?.[provider]?.[tier];
    return tierConfig?.retryConfig || {
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2
    };
}

function getPromptForLanguage(promptPath, language = 'en') {
    // Navigate the prompt path (e.g., 'defaults.systemPrompt')
    const parts = promptPath.split('.');
    let current = prompts;
    for (const part of parts) {
        if (current[part] === undefined) {
            console.warn(`Prompt path not found: ${promptPath}`);
            return '';
        }
        current = current[part];
    }
    // Return the language-specific prompt, fallback to English
    return current[language] || current['en'] || '';
}

function getDefaultConfig() {
    const defaultLanguage = 'en';
    const defaultProvider = models.defaultProvider || 'openai';
    const defaultTier = models.defaultTier || 'balanced';

    return {
        apiKey: '',
        googleApiKey: '', // Separate API key for Google Gemini
        // New tier-based model selection
        provider: defaultProvider,
        tier: defaultTier,
        // Legacy fields kept for backward compatibility
        model: getModelForTier(defaultProvider, defaultTier, 'analyze'),
        whisperModel: getModelForTier(defaultProvider, defaultTier, 'transcribe'),
        systemPrompt: getPromptForLanguage('defaults.systemPrompt', defaultLanguage),
        knowledgeBasePaths: [],
        // Language for AI responses: 'en', 'es', 'pt-br'
        language: defaultLanguage,
        // Input mode: 'system', 'microphone', or 'keyboard'
        inputMode: 'system',
        // Audio input source
        inputDeviceId: 'default',
        // System audio device ID (for Linux monitor devices)
        systemAudioDeviceId: '',
        conversationHistory: [], // Array of { role, content } pairs
        // Assistants API settings
        assistantId: null,
        vectorStoreId: null,
        threadId: null,
        briefMode: true, // Force short answers
        hasCompletedOnboarding: false // Flag to track if user has seen the onboarding tutorial
    };
}

async function ensureConfigDir() {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
    } catch (error) {
        // Directory might already exist
    }
}

async function loadConfig() {
    try {
        await ensureConfigDir();
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        const savedConfig = JSON.parse(data);

        // Migration: if old config doesn't have tier/provider, derive from model
        if (!savedConfig.tier && savedConfig.model) {
            // Try to detect tier from old model
            if (savedConfig.model.includes('mini') || savedConfig.model.includes('fast')) {
                savedConfig.tier = 'fast';
            } else {
                savedConfig.tier = 'balanced';
            }
            savedConfig.provider = 'openai';
        }

        return { ...getDefaultConfig(), ...savedConfig };
    } catch (error) {
        // Config doesn't exist, return defaults
        return getDefaultConfig();
    }
}

async function saveConfig(config) {
    await ensureConfigDir();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

module.exports = {
    loadConfig,
    saveConfig,
    getDefaultConfig,
    getModels,
    getPrompts,
    getPromptForLanguage,
    getTiers,
    getProviders,
    getModelForTier,
    getModelListForTier,
    getTierConfig,
    getRetryConfig,
    getSpecialModel,
    CONFIG_DIR,
    CONFIG_FILE
};
