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
    return {
        apiKey: '',
        model: models.chat.default,
        whisperModel: models.transcription.default,
        systemPrompt: getPromptForLanguage('defaults.systemPrompt', defaultLanguage),
        knowledgeBasePaths: [],
        // Language for AI responses: 'en', 'es', 'pt-br'
        language: defaultLanguage,
        // Input mode: 'system', 'microphone', or 'keyboard'
        inputMode: 'system',
        // Audio input source
        inputDeviceId: 'default',
        conversationHistory: [], // Array of { role, content } pairs
        // Assistants API settings
        assistantId: null,
        vectorStoreId: null,
        threadId: null,
        briefMode: false // Force short answers
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
    CONFIG_DIR,
    CONFIG_FILE
};
