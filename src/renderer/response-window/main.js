/**
 * VARS - Response Window Main Script
 * Handles display of AI responses in the independent window
 * Unified queue system for both normal and Smart Listener responses
 */

// Unified queue state
let queue = [];            // All questions/responses (normal + smart listener)
let activeTabId = null;    // Currently viewed tab
let lastPrompt = '';
let queueCounter = 0;      // Global counter for unique IDs

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    const responseContent = document.getElementById('response-content');
    const responseTimestamp = document.getElementById('response-timestamp');
    const responseModel = document.getElementById('response-model');
    const questionSection = document.getElementById('question-section');
    const questionText = document.getElementById('question-text');
    const slQueueTabs = document.getElementById('sl-queue-tabs');
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
            e.target.closest('.regen-btn') || e.target.closest('.code-copy-btn') ||
            e.target.closest('.sl-queue-tab')) {
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
            // Smart listener response — add to queue but don't auto-focus
            if (data.smartListener && data.queueItem) {
                handleSmartListenerResponse(data);
                return;
            }

            // Normal response — add to queue AND auto-focus immediately
            handleNormalResponse(data);
        }
    });

    /**
     * Handle a normal (user-asked) AI response.
     * Creates a queue item, adds it, and immediately selects it.
     */
    function handleNormalResponse(data) {
        queueCounter++;
        const item = {
            id: `normal-${queueCounter}-${Date.now()}`,
            source: 'normal',
            question: data.prompt || '',
            response: data.html,       // already formatted HTML
            rawResponse: null,
            status: 'ready',
            viewed: true,              // auto-viewed since user asked
            timestamp: Date.now(),
            model: data.model || ''
        };

        queue.push(item);

        // Show tabs (always visible once we have items)
        slQueueTabs.classList.remove('hidden');
        renderQueueTabs();

        // Always focus on the new normal response
        selectQueueTab(item.id);
    }

    /**
     * Handle a smart listener response — add to queue but don't auto-focus.
     * Only auto-selects if it's the very first item in the queue.
     */
    function handleSmartListenerResponse(data) {
        const qi = data.queueItem;

        queueCounter++;
        const item = {
            id: qi.id || `sl-${queueCounter}-${Date.now()}`,
            source: 'smart-listener',
            question: qi.question || '',
            response: qi.response || null,
            rawResponse: qi.response || null,
            status: qi.status || 'generating',
            viewed: false,             // NOT auto-viewed — user must click
            timestamp: qi.timestamp || Date.now(),
            model: 'Smart Listener'
        };

        // Check if already exists (update)
        const existingIdx = queue.findIndex(q => q.id === item.id);
        if (existingIdx !== -1) {
            queue[existingIdx] = { ...queue[existingIdx], ...item };
        } else {
            queue.push(item);
        }

        // Show tabs
        slQueueTabs.classList.remove('hidden');
        renderQueueTabs();

        // Only auto-select if no tab is active yet (first item ever)
        if (activeTabId === null && queue.length === 1) {
            selectQueueTab(item.id);
        }

        resizeToContent();
    }

    /**
     * Render queue tabs in the footer bar
     */
    function renderQueueTabs() {
        slQueueTabs.innerHTML = '';

        queue.forEach((item, index) => {
            const tab = document.createElement('button');
            tab.className = 'sl-queue-tab';
            tab.textContent = `Q${index + 1}`;
            tab.setAttribute('data-tooltip', truncateText(item.question, 50));

            // State classes
            if (item.id === activeTabId) tab.classList.add('active');

            if (item.source === 'smart-listener') {
                // Smart Listener items: show viewed/unviewed state
                if (item.viewed) {
                    tab.classList.add('viewed');
                } else if (item.status === 'ready') {
                    tab.classList.add('unviewed');
                }
                if (item.status === 'generating') tab.classList.add('generating');
                if (item.status === 'error') tab.classList.add('error');
            } else {
                // Normal items: always "viewed", just dim non-active
                if (item.id !== activeTabId) {
                    tab.classList.add('viewed');
                }
            }

            tab.addEventListener('click', () => {
                selectQueueTab(item.id);
            });

            slQueueTabs.appendChild(tab);
        });
    }

    /**
     * Select and display a queue tab
     */
    function selectQueueTab(itemId) {
        activeTabId = itemId;
        const item = queue.find(q => q.id === itemId);

        if (!item) return;

        // Mark as viewed (only matters for smart-listener items)
        if (!item.viewed && item.source === 'smart-listener') {
            item.viewed = true;
            if (window.responseAPI.smartListener) {
                window.responseAPI.smartListener.markViewed(itemId);
            }
        }

        // Display question
        if (item.question && item.question.trim()) {
            questionText.textContent = item.question;
            questionSection.classList.remove('hidden');
        } else {
            questionSection.classList.add('hidden');
        }

        // Display response content
        if (item.status === 'ready' && (item.response || item.rawResponse)) {
            if (item.source === 'normal') {
                // Normal: response is already formatted HTML
                responseContent.innerHTML = item.response;
            } else {
                // Smart Listener: raw text needs formatting
                responseContent.innerHTML = item.rawResponse ? formatResponse(item.rawResponse) : (item.response || '');
            }
        } else if (item.status === 'generating') {
            responseContent.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">Generating response...</p>';
        } else if (item.status === 'error') {
            responseContent.innerHTML = `<p style="color: var(--error);">${escapeHtml(item.response || 'Error generating response')}</p>`;
        } else {
            responseContent.innerHTML = '<p style="color: var(--text-secondary);">Waiting...</p>';
        }

        // Update metadata
        const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        responseTimestamp.textContent = time;
        responseModel.textContent = item.model || '';
        if (item.model) {
            responseModel.classList.remove('hidden');
        }

        lastPrompt = item.question || '';

        setupCodeBlockCopyButtons();
        renderQueueTabs();
        resizeToContent();
    }

    /**
     * Truncate text for tooltip
     */
    function truncateText(text, maxLen) {
        if (!text) return '';
        return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
    }

    // Smart Listener IPC listeners
    if (window.responseAPI.smartListener) {
        // New question detected by smart listener
        window.responseAPI.smartListener.onNewQuestion((queueItem) => {
            const existingIdx = queue.findIndex(q => q.id === queueItem.id);
            if (existingIdx === -1) {
                queueCounter++;
                queue.push({
                    id: queueItem.id,
                    source: 'smart-listener',
                    question: queueItem.question || '',
                    response: queueItem.response || null,
                    rawResponse: queueItem.response || null,
                    status: queueItem.status || 'generating',
                    viewed: false,
                    timestamp: queueItem.timestamp || Date.now(),
                    model: 'Smart Listener'
                });
            } else {
                queue[existingIdx] = { ...queue[existingIdx], ...queueItem };
            }

            slQueueTabs.classList.remove('hidden');
            renderQueueTabs();
            resizeToContent();
        });

        // Response ready for a smart listener question
        window.responseAPI.smartListener.onResponseReady((queueItem) => {
            const existingIdx = queue.findIndex(q => q.id === queueItem.id);
            if (existingIdx !== -1) {
                queue[existingIdx].status = queueItem.status;
                queue[existingIdx].response = queueItem.response;
                queue[existingIdx].rawResponse = queueItem.response;
            } else {
                queueCounter++;
                queue.push({
                    id: queueItem.id,
                    source: 'smart-listener',
                    question: queueItem.question || '',
                    response: queueItem.response || null,
                    rawResponse: queueItem.response || null,
                    status: queueItem.status || 'ready',
                    viewed: false,
                    timestamp: queueItem.timestamp || Date.now(),
                    model: 'Smart Listener'
                });
            }

            renderQueueTabs();

            // If this tab is currently active, refresh the view
            if (activeTabId === queueItem.id) {
                selectQueueTab(queueItem.id);
            }

            // If no tab is active yet, auto-select the first ready item
            if (activeTabId === null && queueItem.status === 'ready') {
                selectQueueTab(queueItem.id);
            }

            resizeToContent();
        });

        // Navigate between queue items via keyboard shortcut (global)
        window.responseAPI.smartListener.onNavigate((direction) => {
            navigateQueue(direction);
        });
    }

    // Local keyboard navigation when response window is focused
    document.addEventListener('keydown', (e) => {
        if (queue.length === 0) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'ArrowLeft') {
            navigateQueue('prev');
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            navigateQueue('next');
            e.preventDefault();
        }
    });

    /**
     * Navigate to the previous or next tab in the queue
     */
    function navigateQueue(direction) {
        if (queue.length === 0) return;

        const currentIdx = queue.findIndex(q => q.id === activeTabId);
        let nextIdx;

        if (direction === 'next') {
            nextIdx = currentIdx < queue.length - 1 ? currentIdx + 1 : 0;
        } else {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : queue.length - 1;
        }

        selectQueueTab(queue[nextIdx].id);
    }

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
                const html = formatResponse(aiResult.response);
                responseContent.innerHTML = html;
                responseTimestamp.textContent = formatTimestamp();

                // Update the active queue item with regenerated response
                const activeItem = queue.find(q => q.id === activeTabId);
                if (activeItem) {
                    activeItem.response = html;
                    activeItem.rawResponse = aiResult.response;
                    activeItem.timestamp = Date.now();
                }

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
    // Clickthrough CTRL key handlers (macOS/Windows)
    setupClickthroughHandlers();

    // Opacity controls
    let currentOpacity = 1.0;
    // Initialize from saved config
    window.responseAPI.getOpacity().then(opacity => {
        if (typeof opacity === 'number') currentOpacity = opacity;
    }).catch(err => console.error('Failed to get opacity:', err));

    const opacityDecreaseBtn = document.getElementById('opacity-decrease-btn');
    const opacityIncreaseBtn = document.getElementById('opacity-increase-btn');

    if (opacityDecreaseBtn) {
        opacityDecreaseBtn.addEventListener('click', () => {
            currentOpacity = Math.round((currentOpacity - 0.1) * 10) / 10;
            if (currentOpacity < 0.2) currentOpacity = 0.2; // Min opacity 0.2
            window.responseAPI.setOpacity(currentOpacity);
        });
    }

    if (opacityIncreaseBtn) {
        opacityIncreaseBtn.addEventListener('click', () => {
            currentOpacity = Math.round((currentOpacity + 0.1) * 10) / 10;
            if (currentOpacity > 1.0) currentOpacity = 1.0; // Max opacity 1.0
            window.responseAPI.setOpacity(currentOpacity);
        });
    }
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

/**
 * Clickthrough CTRL key handlers for the response window.
 * When clickthrough is active and the user holds CTRL,
 * the window temporarily becomes interactive.
 */
let isClickthroughActive = false;

function setupClickthroughHandlers() {
    // Listen for clickthrough state changes from main
    window.responseAPI.onClickthroughChanged((enabled) => {
        isClickthroughActive = enabled;
        const container = document.getElementById('response-container');
        if (container) {
            if (enabled) {
                container.classList.add('clickthrough-active');
            } else {
                container.classList.remove('clickthrough-active');
            }
        }
    });

    // CTRL key detection (only useful on macOS/Windows)
    // On Linux, forward: true is not supported
    const isLinux = navigator.platform.toLowerCase().includes('linux');
    if (isLinux) return;

    let isInteracting = false;

    document.addEventListener('mousemove', (e) => {
        if (!isClickthroughActive) return;
        if (e.ctrlKey && !isInteracting) {
            isInteracting = true;
            window.responseAPI.setIgnoreMouseEvents(false);
        } else if (!e.ctrlKey && isInteracting) {
            isInteracting = false;
            window.responseAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    });

    document.addEventListener('keyup', (e) => {
        if (!isClickthroughActive) return;
        if (e.key === 'Control' && isInteracting) {
            isInteracting = false;
            window.responseAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    });

    document.addEventListener('mouseleave', () => {
        if (isClickthroughActive && isInteracting) {
            isInteracting = false;
            window.responseAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    });
}
