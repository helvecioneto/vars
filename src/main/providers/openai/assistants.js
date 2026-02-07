/**
 * VARS - OpenAI Assistants
 * Knowledge base and Assistant API operations
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { getClient } = require('./client');
const { getModels, getPrompts, getPromptForLanguage, getSpecialModel } = require('../../config');

/**
 * Initialize or retrieve an assistant
 */
async function initializeAssistant(apiKey, currentAssistantId) {
    const openai = getClient(apiKey);
    let assistant;

    if (currentAssistantId) {
        try {
            assistant = await openai.beta.assistants.retrieve(currentAssistantId);
            return assistant;
        } catch (error) {
            console.log('Assistant not found or invalid, creating new one...');
        }
    }

    const prompts = getPrompts();
    const assistantModel = getSpecialModel('openai', 'assistant') || 'gpt-4o-mini';
    assistant = await openai.beta.assistants.create({
        name: prompts.assistant.name,
        instructions: prompts.assistant.instructions['en'],
        model: assistantModel,
        tools: [{ type: "file_search" }]
    });

    return assistant;
}

/**
 * Create knowledge base (Vector Store)
 */
async function createKnowledgeBase(apiKey, filePaths, existingVectorStoreId) {
    const openai = getClient(apiKey);
    let vectorStore;

    if (existingVectorStoreId) {
        try {
            vectorStore = await openai.beta.vectorStores.retrieve(existingVectorStoreId);
        } catch (e) {
            console.log('Vector store not found, creating new one');
        }
    }

    if (!vectorStore) {
        vectorStore = await openai.beta.vectorStores.create({ name: "VARS Documents" });
    }

    const uploadedFileIds = [];

    for (const filePath of filePaths) {
        let retries = 3;
        let success = false;

        while (retries > 0 && !success) {
            try {
                console.log(`[DEBUG] Uploading file: ${filePath} (Retries left: ${retries - 1})`);

                const file = await openai.files.create(
                    { file: fs.createReadStream(filePath), purpose: "assistants" },
                    { timeout: 300000 }
                );

                uploadedFileIds.push(file.id);
                console.log(`[DEBUG] Uploaded ${filePath} as ${file.id}`);
                success = true;
            } catch (e) {
                console.error(`[ERROR] Failed to upload ${filePath}:`, e);
                retries--;
                if (retries === 0) {
                    throw new Error(`Failed to upload ${path.basename(filePath)} after 3 attempts. Last error: ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    if (uploadedFileIds.length > 0) {
        console.log(`[DEBUG] Adding ${uploadedFileIds.length} files to Vector Store ${vectorStore.id}`);
        await openai.beta.vectorStores.fileBatches.createAndPoll(
            vectorStore.id,
            { file_ids: uploadedFileIds }
        );
    }

    return vectorStore.id;
}

/**
 * Update assistant with vector store
 */
async function updateAssistantVectorStore(apiKey, assistantId, vectorStoreId) {
    const openai = getClient(apiKey);
    await openai.beta.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } }
    });
}

/**
 * Reset knowledge base
 */
async function resetKnowledgeBase(apiKey, vectorStoreId) {
    const openai = getClient(apiKey);
    if (vectorStoreId) {
        try {
            await openai.beta.vectorStores.del(vectorStoreId);
        } catch (e) {
            // Ignore if already deleted
        }
    }
    return null;
}

/**
 * Get response using Assistants API
 */
async function getAssistantResponse(apiKey, assistantId, threadId, userMessage, model, systemPrompt, filePaths = [], briefMode = false, language = 'en') {
    const openai = getClient(apiKey);
    let thread;

    if (threadId) {
        try {
            thread = await openai.beta.threads.retrieve(threadId);
        } catch (e) {
            thread = await openai.beta.threads.create();
        }
    } else {
        thread = await openai.beta.threads.create();
    }

    await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: userMessage
    });

    const runOptions = { assistant_id: assistantId };

    const models = getModels();
    const unsupportedAssistantModels = models.assistant_unsupported_models || [];

    if (model && !unsupportedAssistantModels.includes(model)) {
        runOptions.model = model;
    }

    const fileList = filePaths && filePaths.length > 0
        ? filePaths.map(p => path.basename(p)).join(', ')
        : "No specific files listed.";

    let baseInstruction = getPromptForLanguage('knowledgeBase.baseInstruction', language)
        .replace('{fileList}', fileList);

    if (briefMode) {
        baseInstruction += getPromptForLanguage('knowledgeBase.briefMode', language);
    }

    if (systemPrompt) {
        runOptions.instructions = `${baseInstruction}\n\nUser Custom Instructions:\n${systemPrompt}`;
    } else {
        runOptions.instructions = baseInstruction;
    }

    console.log('[DEBUG] Starting Run with options:', JSON.stringify(runOptions));

    const run = await openai.beta.threads.runs.createAndPoll(thread.id, runOptions);

    console.log('[DEBUG] Run Status:', run.status);

    let responseText = "";

    if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(run.thread_id);
        const lastMessage = messages.data.filter(msg => msg.role === 'assistant').shift();

        if (lastMessage && lastMessage.content) {
            for (const contentBlock of lastMessage.content) {
                if (contentBlock.type === 'text') {
                    let text = contentBlock.text.value;
                    text = text.replace(/【\d+:\d+†.*?】/g, '');
                    responseText += text;
                }
            }
        }
    } else {
        responseText = `Error: Run finished with status: ${run.status}`;
    }

    return { response: responseText, threadId: thread.id };
}

module.exports = {
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase,
    getAssistantResponse
};
