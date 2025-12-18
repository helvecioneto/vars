const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.hearing-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function getDefaultConfig() {
    return {
        apiKey: '',
        model: 'gpt-4o-mini',
        whisperModel: 'gpt-4o-mini-transcribe',
        systemPrompt: 'You are a helpful assistant that answers questions based on the provided knowledge base. Be concise and direct in your answers. If the question is not related to the knowledge base, answer based on your general knowledge but mention that.',
        knowledgeBasePaths: [],
        // Language for AI responses: 'en', 'es', 'pt-br'
        language: 'en',
        // Input mode: 'system', 'microphone', or 'keyboard'
        inputMode: 'system',
        // Device settings
        inputDeviceId: 'default',
        inputDeviceId: 'default',
        outputDeviceId: 'default',
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
    CONFIG_DIR,
    CONFIG_FILE
};
