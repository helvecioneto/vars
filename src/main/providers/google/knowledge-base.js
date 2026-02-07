/**
 * VARS - Google Knowledge Base
 * File Search Store operations for Google Gemini
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { getGenAIClient } = require('./client');
const { sleep } = require('../shared/retry');

/**
 * Create a new File Search Store
 */
async function createFileSearchStore(apiKey, displayName = 'VARS Knowledge Base') {
    const ai = getGenAIClient(apiKey);

    try {
        const store = await ai.fileSearchStores.create({
            config: { displayName: displayName }
        });
        console.log('[File Search] Created store:', store.name);
        return store.name;
    } catch (error) {
        throw new Error(`Failed to create File Search Store: ${error.message}`);
    }
}

/**
 * Get existing File Search Store by name
 */
async function getFileSearchStore(apiKey, storeName) {
    const ai = getGenAIClient(apiKey);

    try {
        const store = await ai.fileSearchStores.get({ name: storeName });
        return store;
    } catch (error) {
        console.warn('[File Search] Store not found:', storeName);
        return null;
    }
}

/**
 * Upload a file to a File Search Store
 */
async function uploadToFileSearchStore(apiKey, storeName, filePath) {
    const ai = getGenAIClient(apiKey);
    const originalFileName = path.basename(filePath);

    const tempDir = require('os').tmpdir();
    const safeName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}${path.extname(filePath)}`;
    const tempFilePath = path.join(tempDir, safeName);
    const sanitizedDisplayName = originalFileName.replace(/[^\x00-\x7F]/g, '_');

    console.log(`[File Search] Staging ${originalFileName} to ${safeName} for safe upload...`);

    try {
        await fsPromises.copyFile(filePath, tempFilePath);

        console.log(`[File Search] Uploading staged file to ${storeName}...`);

        let operation = await ai.fileSearchStores.uploadToFileSearchStore({
            file: tempFilePath,
            fileSearchStoreName: storeName,
            config: { displayName: sanitizedDisplayName }
        });

        if (operation.name) {
            console.log(`[File Search] Upload initiated:`, operation.name);
            const opName = operation.name;
            let pollErrors = 0;

            while (true) {
                if (operation.done) break;
                await new Promise(resolve => setTimeout(resolve, 1000));

                try {
                    const updatedOp = await ai.operations.get({ name: opName });
                    if (updatedOp) operation = updatedOp;
                } catch (e) {
                    console.warn('[File Search] Polling warning:', e.message);
                    pollErrors++;
                    if (pollErrors >= 3) {
                        console.log('[File Search] Stopping status check due to SDK errors.');
                        break;
                    }
                }
            }
            console.log(`[File Search] File upload sequence completed.`);
        }

        return operation;
    } catch (error) {
        throw new Error(`Failed to upload file ${originalFileName}: ${error.message}`);
    } finally {
        try {
            await fsPromises.unlink(tempFilePath);
        } catch (e) {
            console.warn('Failed to cleanup temp file:', tempFilePath);
        }
    }
}

/**
 * Delete a File Search Store
 */
async function deleteFileSearchStore(apiKey, storeName, force = true) {
    if (!storeName) return;

    const ai = getGenAIClient(apiKey);

    try {
        await ai.fileSearchStores.delete({ name: storeName, config: { force } });
        console.log('[File Search] Deleted store:', storeName);
    } catch (error) {
        console.warn(`[File Search] Failed to delete store: ${error.message}`);
    }
}

/**
 * Create knowledge base for Google (File Search Store)
 */
async function createGoogleKnowledgeBase(apiKey, filePaths, existingStoreName = null) {
    let storeName = existingStoreName;

    if (storeName) {
        const existing = await getFileSearchStore(apiKey, storeName);
        if (!existing) {
            console.log('[File Search] Existing store not found, creating new one');
            storeName = null;
        }
    }

    if (!storeName) {
        storeName = await createFileSearchStore(apiKey, 'VARS Knowledge Base');
    }

    for (const filePath of filePaths) {
        try {
            await fsPromises.access(filePath);
            await uploadToFileSearchStore(apiKey, storeName, filePath);
            await sleep(500);
        } catch (error) {
            console.error(`[File Search] Error uploading ${filePath}:`, error.message);
        }
    }

    return storeName;
}

/**
 * Reset (delete) Google knowledge base
 */
async function resetGoogleKnowledgeBase(apiKey, storeName) {
    await deleteFileSearchStore(apiKey, storeName, true);
}

module.exports = {
    createFileSearchStore,
    getFileSearchStore,
    uploadToFileSearchStore,
    deleteFileSearchStore,
    createGoogleKnowledgeBase,
    resetGoogleKnowledgeBase
};
