/**
 * VARS - OpenAI Provider Index
 * Re-exports all OpenAI functions for backward compatibility
 */

const { transcribeAudio } = require('./transcription');
const { getSmartAIResponse } = require('./chat');
const { analyzeImageOpenAI } = require('./vision');
const {
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase
} = require('./assistants');

module.exports = {
    transcribeAudio,
    getSmartAIResponse,
    analyzeImageOpenAI,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase
};
