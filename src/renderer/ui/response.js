/**
 * VARS - Response Display Module
 * Handles transcription and AI response display
 */

import { state, setLastPrompt } from '../state/index.js';
import { elements } from './elements.js';
import { updateStatus } from './status.js';
import { formatTimestamp, escapeHtml } from '../utils/format.js';
import { handleApiError } from '../utils/api-errors.js';
import { updateHistory } from '../history/index.js';

/**
 * Show transcription in the UI
 * @param {string} text - The transcribed text
 */
export function showTranscription(text) {
    // Show section when there's content
    if (text && text.trim()) {
        // Store for regeneration
        setLastPrompt(text);

        if (elements.contentArea) elements.contentArea.classList.remove('hidden');
        if (elements.transcriptionSection) elements.transcriptionSection.classList.remove('hidden');
        if (elements.transcriptionContent) elements.transcriptionContent.innerHTML = escapeHtml(text);
        if (elements.transcriptionTimestamp) elements.transcriptionTimestamp.textContent = formatTimestamp();
    } else {
        if (elements.transcriptionSection) elements.transcriptionSection.classList.add('hidden');
    }
}

/**
 * Show AI response in the independent response window
 * @param {string} text - The AI response text
 */
export function showResponse(text) {
    if (text && text.trim()) {
        const formattedText = formatResponse(text);
        const timestamp = formatTimestamp();

        // Get model name from config preset
        const preset = state.config.qualityPreset || 'auth';
        const modelName = getPresetLabel(preset);

        // Send to the independent response window via IPC
        window.electronAPI.showInResponseWindow({
            html: formattedText,
            timestamp: timestamp,
            prompt: state.lastPrompt || '',
            model: modelName
        });
    }
}

/**
 * Get display label for a quality preset
 */
const PRESET_LABELS = {
    'auth': 'Auth',
    'openai-fast': 'Fast',
    'openai-balanced': 'Balanced',
    'openai-quality': 'Quality',
    'google-free': 'Free',
    'google-fast': 'Fast (G)',
    'google-balanced': 'Balanced (G)',
    'google-quality': 'Quality (G)'
};

function getPresetLabel(preset) {
    return PRESET_LABELS[preset] || preset || 'Balanced';
}

/**
 * Setup main copy button for AI responses
 */
export function setupCopyButton() {
    if (elements.copyResponseBtn) {
        // Remove old listener and add new one
        elements.copyResponseBtn.replaceWith(elements.copyResponseBtn.cloneNode(true));
        const newCopyBtn = document.getElementById('copy-response-btn');

        newCopyBtn.addEventListener('click', async () => {
            const responseText = elements.responseContent?.innerText || '';
            await copyToClipboard(responseText, newCopyBtn);
        });
    }
}

/**
 * Setup regenerate button for AI responses
 */
export function setupRegenerateButton() {
    const regenBtn = document.getElementById('regen-response-btn');
    if (regenBtn) {
        // Remove loading class before cloning to prevent disabled state
        regenBtn.classList.remove('loading');

        // Remove old listener and add new one
        regenBtn.replaceWith(regenBtn.cloneNode(true));
        const newRegenBtn = document.getElementById('regen-response-btn');

        newRegenBtn.addEventListener('click', async () => {
            // Use stored lastPrompt for reliable regeneration
            const currentPrompt = state.lastPrompt || elements.transcriptionContent?.innerText || state.fullTranscription;

            if (!currentPrompt || !currentPrompt.trim()) {
                return;
            }

            // Show loading state
            newRegenBtn.classList.add('loading');
            updateStatus('Regenerating...', 'processing');

            try {
                const aiResult = await window.electronAPI.getAIResponse(currentPrompt);

                if (handleApiError(aiResult)) {
                    newRegenBtn.classList.remove('loading');
                    return;
                }

                showResponse(aiResult.response);
                updateStatus('Ready', 'ready');

                // Update History with regenerated response
                updateHistory(currentPrompt, aiResult.response);
            } catch (error) {
                console.error('Regenerate error:', error);
                updateStatus('Error', 'error');
            } finally {
                newRegenBtn.classList.remove('loading');
            }
        });
    }
}

/**
 * Setup copy buttons for code blocks
 */
export function setupCodeBlockCopyButtons() {
    const codeBlocks = document.querySelectorAll('.code-block');
    codeBlocks.forEach((block, index) => {
        const copyBtn = block.querySelector('.code-copy-btn');
        const codeElement = block.querySelector('code');

        if (copyBtn && codeElement) {
            copyBtn.addEventListener('click', async () => {
                const codeText = codeElement.textContent || '';
                await copyToClipboard(codeText, copyBtn);
            });
        }
    });
}

/**
 * Copy text to clipboard with visual feedback
 * @param {string} text - Text to copy
 * @param {HTMLElement} buttonElement - Button element for visual feedback
 */
export async function copyToClipboard(text, buttonElement) {
    try {
        await navigator.clipboard.writeText(text);

        // Visual feedback
        if (buttonElement) {
            buttonElement.classList.add('copied');
            const copyIcon = buttonElement.querySelector('.copy-icon');
            const checkIcon = buttonElement.querySelector('.check-icon');

            if (copyIcon) copyIcon.classList.add('hidden');
            if (checkIcon) checkIcon.classList.remove('hidden');

            setTimeout(() => {
                buttonElement.classList.remove('copied');
                if (copyIcon) copyIcon.classList.remove('hidden');
                if (checkIcon) checkIcon.classList.add('hidden');
            }, 2000);
        }
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

/**
 * Format AI response text with markdown-like styling
 * @param {string} text - Raw response text
 * @returns {string} HTML formatted text
 */
export function formatResponse(text) {
    // Process code blocks first (triple backticks)
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
        const lang = language || 'code';
        const escapedCode = escapeHtml(code.trim());
        return `<div class="code-block">
            <div class="code-block-header">
                <span class="code-language">${lang}</span>
                <button class="code-copy-btn" data-tooltip="Copy code">
                    <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <svg class="check-icon hidden" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
            </div>
            <pre><code>${escapedCode}</code></pre>
        </div>`;
    });

    // Bold text
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic text
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Inline code (single backticks, but not inside code blocks)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Unordered lists
    text = text.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    text = text.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs (double newlines)
    text = text.replace(/\n\n+/g, '</p><p>');

    // Single newlines to line breaks (but not inside code blocks)
    text = text.replace(/\n/g, '<br>');

    // Wrap in paragraph if not already
    if (!text.startsWith('<') && !text.startsWith('</p>')) {
        text = '<p>' + text + '</p>';
    }

    // Clean up empty paragraphs
    text = text.replace(/<p>\s*<\/p>/g, '');
    text = text.replace(/<p><br>/g, '<p>');

    return text;
}
