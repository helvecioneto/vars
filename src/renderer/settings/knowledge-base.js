/**
 * VARS - Knowledge Base Module
 * Handles knowledge base training and management
 */

import { state, setConfig } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateStatus } from '../ui/status.js';
import { escapeHtml } from '../utils/format.js';

/**
 * Update the file list display
 */
export function updateFileList() {
    const files = state.config.knowledgeBasePaths || [];

    if (files.length === 0) {
        elements.fileList.innerHTML = '<p class="placeholder">No files added</p>';
        return;
    }

    elements.fileList.innerHTML = files.map((filePath, index) => {
        const fileName = filePath.split('/').pop().split('\\').pop();
        return `
      <div class="file-item">
        <span class="file-name" title="${escapeHtml(filePath)}">📄 ${escapeHtml(fileName)}</span>
        <button class="remove-btn" data-index="${index}" title="Remove">✕</button>
      </div>
    `;
    }).join('');

    // Add remove handlers
    elements.fileList.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            state.config.knowledgeBasePaths.splice(index, 1);
            updateFileList();
            window.electronAPI.saveConfig(state.config); // Sync to main process
        });
    });
}

/**
 * Handle file selection for knowledge base
 * @param {Event} event - File input change event
 */
export function handleFileSelection(event) {
    const files = Array.from(event.target.files);

    if (!state.config.knowledgeBasePaths) {
        state.config.knowledgeBasePaths = [];
    }

    files.forEach(file => {
        // Use the file path if available (Electron provides this)
        const filePath = file.path || file.name;
        if (!state.config.knowledgeBasePaths.includes(filePath)) {
            state.config.knowledgeBasePaths.push(filePath);
        }
    });

    updateFileList();
    window.electronAPI.saveConfig(state.config); // Sync to main process
    event.target.value = ''; // Reset input
}

/**
 * Handle knowledge base training
 */
export async function handleTrainKB() {
    if (elements.kbStatus) elements.kbStatus.innerText = '⏳ Initializing Assistant & Indexing... This may take a moment.';

    // Disable buttons
    elements.trainBtn.disabled = true;

    try {
        const result = await window.electronAPI.createKnowledgeBase();

        if (result.success) {
            // RELOAD CONFIG to get the new assistantId/vectorStoreId
            const newConfig = await window.electronAPI.getConfig();
            setConfig(newConfig);

            if (elements.kbStatus) elements.kbStatus.innerText = `✅ Success! Indexed ${result.count} files.`;
            // Refresh main status bar
            updateStatus('Ready', 'ready');
            // Flash success color
            setTimeout(() => { if (elements.kbStatus) elements.kbStatus.innerText = 'Ready. Knowledge Base Active.'; }, 5000);
        } else {
            if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${result.error}`;
        }
    } catch (e) {
        if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${e.message}`;
    } finally {
        elements.trainBtn.disabled = false;
    }
}

/**
 * Handle knowledge base reset
 */
export async function handleResetKB() {
    if (!confirm('Are you sure you want to delete the Knowledge Base? This will delete the Vector Store from OpenAI.')) return;

    if (elements.kbStatus) elements.kbStatus.innerText = '⏳ Resetting...';

    try {
        const result = await window.electronAPI.resetKnowledgeBase();

        if (result.success) {
            const newConfig = await window.electronAPI.getConfig();
            setConfig(newConfig);
            if (elements.kbStatus) elements.kbStatus.innerText = '✅ Knowledge Base Cleared.';
            // Refresh main status bar
            updateStatus('Ready', 'ready');
        } else {
            if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${result.error}`;
        }
    } catch (e) {
        if (elements.kbStatus) elements.kbStatus.innerText = `❌ Error: ${e.message}`;
    }
}
