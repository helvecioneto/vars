/**
 * Quiz Solver UI Module
 * Handles the Quiz Solver button and status updates
 */

import { updateStatus } from '../ui/status.js';
import { elements } from '../ui/elements.js';

let isQuizSolverActive = false;

/**
 * Initialize Quiz Solver UI
 */
export function initQuizSolver() {
    // Check if we have the elements (assuming we'll add them to index.html)
    // We'll trust the main.js or index.html to have created them or we find them here.

    const quizBtn = document.getElementById('quiz-solver-btn');
    if (quizBtn) {
        quizBtn.addEventListener('click', toggleQuizSolver);
    }

    // Listen for status updates from main process
    if (window.electronAPI.quizSolver) {
        window.electronAPI.quizSolver.onStatus((data) => {
            handleQuizStatus(data);
        });

        // Listen for hotkey toggles
        window.electronAPI.onToggleQuizSolver(() => {
            toggleQuizSolver();
        });
    }
}

/**
 * Toggle the quiz solver state
 */
async function toggleQuizSolver() {
    if (!window.electronAPI.quizSolver) return;

    if (isQuizSolverActive) {
        // Stop
        const result = await window.electronAPI.quizSolver.stop();
        if (result.success) {
            isQuizSolverActive = false;
            updateQuizUI(false);
            updateStatus('Quiz Auto-Solver stopped', 'ready');
        }
    } else {
        // Start
        updateStatus('Starting Quiz Auto-Solver...', 'processing');
        const result = await window.electronAPI.quizSolver.start();
        if (result.success) {
            isQuizSolverActive = true;
            updateQuizUI(true);
            updateStatus('Quiz Auto-Solver active - Scanning...', 'recording');
        } else {
            updateStatus('Failed to start: ' + result.error, 'error');
        }
    }
}

/**
 * Update UI state
 * @param {boolean} active 
 */
function updateQuizUI(active) {
    const quizBtn = document.getElementById('quiz-solver-btn');
    if (quizBtn) {
        if (active) {
            quizBtn.classList.add('active');
            quizBtn.classList.add('recording'); // Pulse effect
        } else {
            quizBtn.classList.remove('active');
            quizBtn.classList.remove('recording');
        }
    }
}

/**
 * Handle status updates from the backend
 * @param {object} data 
 */
function handleQuizStatus(data) {
    switch (data.status) {
        case 'scanning':
            // updateStatus('Scanning for quiz...', 'processing'); 
            // Don't spam status too much, maybe just keep "active"
            break;

        case 'answering':
            updateStatus(`Found Answer: ${data.answer}`, 'processing');
            break;

        case 'answered':
            updateStatus(`Clicked: ${data.answer}`, 'success');
            setTimeout(() => {
                if (isQuizSolverActive) updateStatus('Scanning...', 'recording');
            }, 2000);
            break;

        case 'next-clicked':
            updateStatus('Clicked Next', 'recording');
            break;

        case 'no-quiz':
            // Quietly ignore or set status if it was different
            // updateStatus('No quiz found', 'ready');
            break;

        case 'error':
            updateStatus('Error: ' + data.message, 'error');
            break;

        case 'stopped':
            isQuizSolverActive = false;
            updateQuizUI(false);
            updateStatus('Quiz Auto-Solver stopped', 'ready');
            break;
    }
}
