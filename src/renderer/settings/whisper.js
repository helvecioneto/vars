/**
 * VARS - Whisper Local Transcription Settings
 * Manages the Local Whisper UI: engine toggle, model selection, download/delete
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { autoSaveConfig } from './auto-save.js';

let isDownloading = false;

/**
 * Initialize Whisper settings UI and event listeners
 */
export function initWhisperSettings() {
    // Transcription preset toggle: show/hide whisper model options
    const transcriptionPreset = document.getElementById('transcription-preset');
    if (transcriptionPreset) {
        transcriptionPreset.addEventListener('change', () => {
            updateWhisperVisibility();
            autoSaveConfig();
        });
    }

    // Model selection change: update status
    if (elements.whisperModelSelect) {
        elements.whisperModelSelect.addEventListener('change', () => {
            updateWhisperModelStatus();
            autoSaveConfig();
        });
    }

    // Download button
    if (elements.whisperDownloadBtn) {
        elements.whisperDownloadBtn.addEventListener('click', handleDownload);
    }

    // Delete button
    if (elements.whisperDeleteBtn) {
        elements.whisperDeleteBtn.addEventListener('click', handleDelete);
    }

    // Listen for download progress from main process
    if (window.electronAPI?.whisper?.onDownloadProgress) {
        window.electronAPI.whisper.onDownloadProgress((progress) => {
            if (elements.whisperProgressFill) {
                elements.whisperProgressFill.style.width = `${progress.percent}%`;
            }
            if (elements.whisperProgressText) {
                const downloadedMB = (progress.downloaded / 1_000_000).toFixed(1);
                const totalMB = (progress.total / 1_000_000).toFixed(1);
                elements.whisperProgressText.textContent = `${downloadedMB} / ${totalMB} MB (${progress.percent}%)`;
            }
        });
    }

    // Initial UI state
    updateWhisperVisibility();
}

/**
 * Show/hide whisper model section based on transcription preset selection
 */
function updateWhisperVisibility() {
    const transcriptionPreset = document.getElementById('transcription-preset');
    const isLocal = transcriptionPreset?.value === 'local';
    const whisperSection = document.getElementById('whisper-local-section');

    if (whisperSection) {
        whisperSection.style.display = isLocal ? '' : 'none';
    }

    if (isLocal) {
        updateWhisperModelStatus();
    }
}

/**
 * Update whisper model download status
 */
async function updateWhisperModelStatus() {
    if (!window.electronAPI?.whisper) return;

    const modelName = elements.whisperModelSelect?.value || 'base';

    try {
        const result = await window.electronAPI.whisper.getModelsStatus();
        if (result.error) {
            setStatusText('Error checking models', false);
            return;
        }

        const model = result.models.find(m => m.name === modelName);
        if (!model) {
            setStatusText(`Model "${modelName}" not found`, false);
            return;
        }

        if (model.downloaded) {
            setStatusText(`✓ Model "${modelName}" ready (${model.size})`, true);
            if (elements.whisperDownloadBtn) elements.whisperDownloadBtn.style.display = 'none';
            if (elements.whisperDeleteBtn) elements.whisperDeleteBtn.style.display = '';
        } else {
            setStatusText(`Model "${modelName}" not downloaded (${model.size})`, false);
            if (elements.whisperDownloadBtn) {
                elements.whisperDownloadBtn.style.display = '';
                elements.whisperDownloadBtn.textContent = `Download (${model.size})`;
            }
            if (elements.whisperDeleteBtn) elements.whisperDeleteBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('[WhisperSettings] Error:', err);
        setStatusText('Error checking model status', false);
    }
}

/**
 * Handle model download
 */
async function handleDownload() {
    if (isDownloading) return;

    const modelName = elements.whisperModelSelect?.value || 'base';
    isDownloading = true;

    // Show progress bar
    if (elements.whisperProgressBar) elements.whisperProgressBar.style.display = '';
    if (elements.whisperDownloadBtn) {
        elements.whisperDownloadBtn.disabled = true;
        elements.whisperDownloadBtn.textContent = 'Downloading...';
    }
    setStatusText(`Downloading "${modelName}"...`, false);

    try {
        const result = await window.electronAPI.whisper.downloadModel(modelName);
        if (result.error) {
            setStatusText(`Download failed: ${result.error}`, false);
        } else {
            setStatusText(`✓ Model "${modelName}" ready!`, true);
            if (elements.whisperDownloadBtn) elements.whisperDownloadBtn.style.display = 'none';
            if (elements.whisperDeleteBtn) elements.whisperDeleteBtn.style.display = '';
        }
    } catch (err) {
        setStatusText(`Download error: ${err.message}`, false);
    } finally {
        isDownloading = false;
        if (elements.whisperProgressBar) elements.whisperProgressBar.style.display = 'none';
        if (elements.whisperDownloadBtn) {
            elements.whisperDownloadBtn.disabled = false;
            elements.whisperDownloadBtn.textContent = 'Download';
        }
        // Refresh status
        await updateWhisperModelStatus();
    }
}

/**
 * Handle model deletion
 */
async function handleDelete() {
    const modelName = elements.whisperModelSelect?.value || 'base';

    try {
        const result = await window.electronAPI.whisper.deleteModel(modelName);
        if (result.error) {
            setStatusText(`Delete failed: ${result.error}`, false);
        } else {
            await updateWhisperModelStatus();
        }
    } catch (err) {
        setStatusText(`Delete error: ${err.message}`, false);
    }
}

/**
 * Set status text and style
 */
function setStatusText(text, isReady) {
    if (elements.whisperStatusText) {
        elements.whisperStatusText.textContent = text;
        elements.whisperStatusText.style.color = isReady ? 'var(--success, #10b981)' : 'var(--text-secondary)';
    }
}
