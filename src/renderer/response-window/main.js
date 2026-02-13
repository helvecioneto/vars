/**
 * VARS - Response Window Main Script
 * Handles display of AI responses in the independent window
 */

// Current state
let lastPrompt = '';

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    const responseContent = document.getElementById('response-content');
    const responseTimestamp = document.getElementById('response-timestamp');
    const responseModel = document.getElementById('response-model');
    const questionSection = document.getElementById('question-section');
    const questionText = document.getElementById('question-text');
    const copyBtn = document.getElementById('copy-response-btn');
    const regenBtn = document.getElementById('regen-response-btn');
    const closeBtn = document.getElementById('close-btn');
    const minimizeBtn = document.getElementById('minimize-btn');
    const responseBody = document.getElementById('response-body');

    // Window controls
    closeBtn.addEventListener('click', () => {
        window.responseAPI.closeWindow();
    });

    minimizeBtn.addEventListener('click', () => {
        window.responseAPI.minimizeWindow();
    });

    // Context menu on right-click
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.responseAPI.showContextMenu();
    });

    // Drag support via toolbar
    const toolbar = document.getElementById('response-toolbar');
    let dragStartPos = null;
    let hasDragged = false;
    const DRAG_THRESHOLD = 5;

    document.addEventListener('mousedown', (e) => {
        // Don't drag from buttons
        if (e.target.closest('.win-btn') || e.target.closest('.copy-btn') ||
            e.target.closest('.regen-btn') || e.target.closest('.code-copy-btn')) {
            return;
        }
        if (e.button !== 0) return;
        dragStartPos = { x: e.screenX, y: e.screenY };
        hasDragged = false;
        window.responseAPI.setDragging(true);
    });

    window.addEventListener('mousemove', (e) => {
        if (dragStartPos && !hasDragged) {
            const dx = Math.abs(e.screenX - dragStartPos.x);
            const dy = Math.abs(e.screenY - dragStartPos.y);
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                hasDragged = true;
            }
        }
    });

    window.addEventListener('mouseup', () => {
        window.responseAPI.setDragging(false);
        dragStartPos = null;
    });

    // Receive response from main process
    window.responseAPI.onDisplayResponse((data) => {
        if (data.html) {
            // Show user's question
            if (data.prompt && data.prompt.trim()) {
                questionText.textContent = data.prompt;
                questionSection.classList.remove('hidden');
            } else {
                questionSection.classList.add('hidden');
            }

            responseContent.innerHTML = data.html;
            responseTimestamp.textContent = data.timestamp || '';
            if (data.model) {
                responseModel.textContent = data.model;
                responseModel.classList.remove('hidden');
            }
            lastPrompt = data.prompt || '';

            // Setup code block copy buttons
            setupCodeBlockCopyButtons();

            // Auto-resize window to fit content
            resizeToContent();
        }
    });

    /**
     * Measure actual content height and resize the BrowserWindow to fit.
     * Temporarily removes overflow clipping so content flows naturally,
     * then measures the document's full scroll height.
     */
    let resizeTimer = null;
    let lastSentHeight = 0;

    function resizeToContent() {
        // Debounce to avoid rapid-fire resizing
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // Temporarily allow body to expand for accurate measurement
            document.body.style.overflow = 'visible';
            document.body.style.height = 'auto';
            document.documentElement.style.height = 'auto';

            // Force layout recalculation
            void document.body.offsetHeight;

            // Measure the full content height
            const totalHeight = document.documentElement.scrollHeight;

            // Restore overflow to prevent scrollbar on body
            document.body.style.overflow = 'hidden';

            // Only send if height actually changed (avoid loops)
            if (Math.abs(totalHeight - lastSentHeight) > 2) {
                lastSentHeight = totalHeight;
                window.responseAPI.sendContentBounds({ height: totalHeight });
            }
        }, 50);
    }

    // Watch for late layout changes (images loading, code highlighting, etc.)
    // Use a flag to prevent the observer from triggering during our own resize
    let isResizing = false;
    const resizeObserver = new ResizeObserver(() => {
        if (!isResizing) {
            isResizing = true;
            resizeToContent();
            setTimeout(() => { isResizing = false; }, 200);
        }
    });
    resizeObserver.observe(responseContent);

    // Handle height cap feedback — enable scroll when content exceeds screen
    window.responseAPI.onContentHeightResult((data) => {
        if (data.capped) {
            // Content is taller than screen — enable scrolling inside response body
            const toolbar = document.querySelector('.response-toolbar');
            const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
            const footer = document.querySelector('.response-footer');
            const footerHeight = footer ? footer.offsetHeight : 0;
            const question = document.getElementById('question-section');
            const questionHeight = (question && !question.classList.contains('hidden')) ? question.offsetHeight : 0;
            const labelSection = document.querySelector('.response-label-section');
            const labelHeight = labelSection ? labelSection.offsetHeight : 0;

            // Calculate available height for scrollable content
            const usedHeight = toolbarHeight + questionHeight + labelHeight + footerHeight + 40; // 40px for padding
            const availableHeight = data.windowHeight - usedHeight;

            responseBody.style.maxHeight = availableHeight + 'px';
            responseBody.style.overflowY = 'auto';
        } else {
            // Content fits — remove scroll constraints
            responseBody.style.maxHeight = '';
            responseBody.style.overflowY = '';
        }
    });

    // Copy button
    copyBtn.addEventListener('click', async () => {
        const text = responseContent.innerText || '';
        try {
            await navigator.clipboard.writeText(text);
            copyBtn.classList.add('copied');
            const copyIcon = copyBtn.querySelector('.copy-icon');
            const checkIcon = copyBtn.querySelector('.check-icon');
            if (copyIcon) copyIcon.classList.add('hidden');
            if (checkIcon) checkIcon.classList.remove('hidden');

            setTimeout(() => {
                copyBtn.classList.remove('copied');
                if (copyIcon) copyIcon.classList.remove('hidden');
                if (checkIcon) checkIcon.classList.add('hidden');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });

    // Regenerate button
    regenBtn.addEventListener('click', async () => {
        if (!lastPrompt || !lastPrompt.trim()) return;

        regenBtn.classList.add('loading');

        try {
            const aiResult = await window.responseAPI.getAIResponse(lastPrompt);
            if (aiResult.error) {
                responseContent.innerHTML = `<p style="color: var(--error);">Error: ${aiResult.error}</p>`;
            } else if (aiResult.response) {
                // The main window will send us the formatted response via IPC
                // But since we're calling directly, we need to format here too
                responseContent.innerHTML = formatResponse(aiResult.response);
                responseTimestamp.textContent = formatTimestamp();
                setupCodeBlockCopyButtons();

                resizeToContent();
            }
        } catch (error) {
            console.error('Regenerate error:', error);
            responseContent.innerHTML = `<p style="color: var(--error);">Error regenerating response</p>`;
        } finally {
            regenBtn.classList.remove('loading');
        }
    });
});

/**
 * Setup copy buttons for code blocks
 */
function setupCodeBlockCopyButtons() {
    const codeBlocks = document.querySelectorAll('.code-block');
    codeBlocks.forEach((block) => {
        const copyBtn = block.querySelector('.code-copy-btn');
        const codeElement = block.querySelector('code');

        if (copyBtn && codeElement) {
            // Clone to remove old listeners
            const newBtn = copyBtn.cloneNode(true);
            copyBtn.replaceWith(newBtn);

            newBtn.addEventListener('click', async () => {
                const codeText = codeElement.textContent || '';
                try {
                    await navigator.clipboard.writeText(codeText);
                    newBtn.style.color = 'var(--success)';
                    setTimeout(() => {
                        newBtn.style.color = '';
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy code:', err);
                }
            });
        }
    });
}

/**
 * Format timestamp
 */
function formatTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format AI response text with markdown-like styling (mirror of main window's formatResponse)
 */
function formatResponse(text) {
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

    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    text = text.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/\n\n+/g, '</p><p>');
    text = text.replace(/\n/g, '<br>');

    if (!text.startsWith('<') && !text.startsWith('</p>')) {
        text = '<p>' + text + '</p>';
    }
    text = text.replace(/<p>\s*<\/p>/g, '');
    text = text.replace(/<p><br>/g, '<p>');

    return text;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
