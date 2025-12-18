const OpenAI = require('openai');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { getModels, getPrompts, getPromptForLanguage } = require('./config');

// Helper to get initialized client
function getClient(apiKey) {
    return new OpenAI({ apiKey });
}

// ==========================================
// Transcription (Whisper)
// ==========================================

async function transcribeAudio(audioBuffer, apiKey, model = 'gpt-4o-mini-transcribe') {
    const openai = getClient(apiKey);

    // Write buffer to a temporary file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `vars-${Date.now()}.webm`);

    try {
        const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
        await fsPromises.writeFile(tempFile, buffer);

        const fileStream = fs.createReadStream(tempFile);

        const transcription = await openai.audio.transcriptions.create({
            file: fileStream,
            model: model,
            language: 'pt' // Defaulting to Portuguese as requested, or can be dynamic
        });

        return transcription.text;
    } finally {
        try {
            await fsPromises.unlink(tempFile);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

// ==========================================
// Knowledge Base (Assistants API)
// ==========================================

async function initializeAssistant(apiKey, currentAssistantId) {
    const openai = getClient(apiKey);
    let assistant;

    // Check if we have a valid assistant ID
    if (currentAssistantId) {
        try {
            assistant = await openai.beta.assistants.retrieve(currentAssistantId);
            return assistant;
        } catch (error) {
            console.log('Assistant not found or invalid, creating new one...');
        }
    }

    // Create new assistant if needed
    const prompts = getPrompts();
    const models = getModels();
    assistant = await openai.beta.assistants.create({
        name: prompts.assistant.name,
        instructions: prompts.assistant.instructions['en'], // Default to English for assistant creation
        model: models.assistant.default, // Must be a model that supports tools
        tools: [{ type: "file_search" }]
    });

    return assistant;
}

async function createKnowledgeBase(apiKey, filePaths, existingVectorStoreId) {
    const openai = getClient(apiKey);
    let vectorStore;

    // 1. Create or get Vector Store
    if (existingVectorStoreId) {
        try {
            vectorStore = await openai.beta.vectorStores.retrieve(existingVectorStoreId);
        } catch (e) {
            console.log('Vector store not found, creating new one');
        }
    }

    if (!vectorStore) {
        vectorStore = await openai.beta.vectorStores.create({
            name: "VARS Documents"
        });
    }

    // 2. Upload files INDIVIDUALLY via Files API to be more robust against network issues
    const uploadedFileIds = [];

    for (const filePath of filePaths) {
        let retries = 3;
        let success = false;

        while (retries > 0 && !success) {
            try {
                console.log(`[DEBUG] Uploading file: ${filePath} (Retries left: ${retries - 1})`);

                // Read into buffer to avoid stream timing issues with node-fetch in Electron
                const fileBuffer = await fsPromises.readFile(filePath);
                // Create a 'File' like object for OpenAI (name + content)
                // The library supports passing a ReadStream, but sometimes Buffers are more stable for ECONNRESET
                // Actually, let's stick to Stream but add options.

                const file = await openai.files.create(
                    {
                        file: fs.createReadStream(filePath),
                        purpose: "assistants",
                    },
                    {
                        timeout: 300000 // 5 minutes timeout
                    }
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
                // Wait 1 second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    // 3. Add files to Vector Store in a batch
    if (uploadedFileIds.length > 0) {
        console.log(`[DEBUG] Adding ${uploadedFileIds.length} files to Vector Store ${vectorStore.id}`);
        await openai.beta.vectorStores.fileBatches.createAndPoll(
            vectorStore.id,
            { file_ids: uploadedFileIds }
        );
    }

    return vectorStore.id;
}

async function updateAssistantVectorStore(apiKey, assistantId, vectorStoreId) {
    const openai = getClient(apiKey);
    await openai.beta.assistants.update(assistantId, {
        tool_resources: {
            file_search: {
                vector_store_ids: [vectorStoreId]
            }
        }
    });
}

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

// ==========================================
// Assistants API Response (Thread/Run)
// ==========================================

async function getAssistantResponse(apiKey, assistantId, threadId, userMessage, model, systemPrompt, filePaths = [], briefMode = false, language = 'en') {
    const openai = getClient(apiKey);
    let thread;




    // 1. Create or Retrieve Thread
    if (threadId) {
        try {
            thread = await openai.beta.threads.retrieve(threadId);
        } catch (e) {
            // Thread might be deleted/expired
            thread = await openai.beta.threads.create();
        }
    } else {
        thread = await openai.beta.threads.create();
    }

    // 2. Add User Message
    await openai.beta.threads.messages.create(
        thread.id,
        {
            role: "user",
            content: userMessage
        }
    );

    // 3. Create and Poll Run with Overrides
    const runOptions = {
        assistant_id: assistantId
    };

    // Override model if provided (and valid for Assistants)
    if (model) {
        runOptions.model = model;
    }

    // Override instructions if provided (System Prompt), BUT keep the KB directive.
    // If we simply replace, we lose the "Use knowledge base" instruction from the Assistant definition.
    // So we append the user's prompt to a strong directive.

    // Build file list string
    const fileList = filePaths && filePaths.length > 0
        ? filePaths.map(p => path.basename(p)).join(', ')
        : "No specific files listed.";

    // Get localized prompts from configuration
    let baseInstruction = getPromptForLanguage('knowledgeBase.baseInstruction', language)
        .replace('{fileList}', fileList);

    // BRIEF MODE ENFORCEMENT
    if (briefMode) {
        baseInstruction += getPromptForLanguage('knowledgeBase.briefMode', language);
    }

    if (systemPrompt) {
        runOptions.instructions = `${baseInstruction}\n\nUser Custom Instructions:\n${systemPrompt}`;
    } else {
        runOptions.instructions = baseInstruction;
    }

    console.log('[DEBUG] Starting Run with options:', JSON.stringify(runOptions));

    const run = await openai.beta.threads.runs.createAndPoll(
        thread.id,
        runOptions
    );

    console.log('[DEBUG] Run Status:', run.status);
    if (run.status === 'completed') {
        console.log('[DEBUG] Run Completed. Usage:', JSON.stringify(run.usage));
    } else {
        console.log('[DEBUG] Run non-complete details:', JSON.stringify(run.last_error));
    }

    let responseText = "";

    if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(
            run.thread_id
        );
        // Get the last message which should be from assistant
        const lastMessage = messages.data
            .filter(msg => msg.role === 'assistant')
            .shift(); // List is default desc order

        if (lastMessage && lastMessage.content) {
            // content is an array
            for (const contentBlock of lastMessage.content) {
                if (contentBlock.type === 'text') {
                    let text = contentBlock.text.value;
                    // Remove citations like 【4:1†TESE_HELVECIO_DADOS.pdf】
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

// ==========================================
// Legacy / Standard Chat Completion
// ==========================================

async function getChatCompletionResponse(transcription, apiKey, model, systemPrompt, language = 'en', history = []) {
    const openai = getClient(apiKey);

    // Get language instruction from configuration
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);

    const messages = [
        {
            role: 'system',
            content: (systemPrompt || 'You are a helpful assistant.') + langInstructions
        },
        ...(history || []),
        {
            role: 'user',
            content: transcription
        }
    ];

    const completion = await openai.chat.completions.create({
        model: model,
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7
    });

    return completion.choices[0].message.content;
}

// Helper to choose between Assistant or Chat Completion
async function getSmartAIResponse({
    transcription, params
}) {
    const { apiKey, model, systemPrompt, language, history,
        assistantId, vectorStoreId, threadId, knowledgeBasePaths, briefMode } = params;

    // Use Assistant if a Knowledge Base is active (vectorStoreId is present)
    // AND we have an assistantId
    console.log('[DEBUG] SmartAI Params:', { assistantId, vectorStoreId, model, briefMode });

    if (assistantId && vectorStoreId) {
        console.log('[DEBUG] Using Assistant API');
        return await getAssistantResponse(apiKey, assistantId, threadId, transcription, model, systemPrompt, knowledgeBasePaths, briefMode, language);
    } else {
        console.log('[DEBUG] Using Chat Completion API');
        // Fallback to standard chat completion
        const response = await getChatCompletionResponse(transcription, apiKey, model, systemPrompt, language, history);
        return { response, threadId: null };
    }
}

// Kept for compatibility but now unused internally for main flow
async function loadKnowledgeBase(filePaths) {
    return '';
}

module.exports = {
    transcribeAudio,
    getSmartAIResponse,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase,
    loadKnowledgeBase
};

