/**
 * VARS - Transcription Module
 * Handles audio transcription functions
 */

import { state, setTranscribing, setFullTranscription, setFinalizing } from '../state/index.js';
import { updateStatus } from '../ui/status.js';
import { showTranscription, showResponse } from '../ui/response.js';
import { updateHistory } from '../history/index.js';
import { handleApiError } from '../utils/api-errors.js';

/**
 * Transcribe current recorded audio chunks
 */
export async function transcribeCurrentAudio() {
    if (state.audioChunks.length === 0) return;

    setTranscribing(true);
    const transcribingMsg = state.currentInputMode === 'system' ? '🔊 Transcribing system audio...' : '🎙️ Transcribing...';
    updateStatus(transcribingMsg, 'recording');

    try {
        // Combine all chunks collected so far
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = new Uint8Array(arrayBuffer);

        const result = await window.electronAPI.transcribeAudio(Array.from(audioBuffer));

        if (result.text && !result.error) {
            setFullTranscription(result.text);
            showTranscription(state.fullTranscription + ' ▌');
        } else if (result.error) {
            console.error('Transcription error:', result.error);
        }

        const statusMsg = state.currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Recording...';
        updateStatus(statusMsg, 'recording');
    } catch (error) {
        console.error('Transcription error:', error);
    } finally {
        setTranscribing(false);
    }
}

/**
 * Transcribe Linux system audio
 */
export async function transcribeLinuxSystemAudio() {
    // Skip if finalizing - let finalizeLinuxSystemAudio handle it
    if (state.isFinalizing) {
        return;
    }

    // Check if capture is active
    const capturingResult = await window.electronAPI.systemAudio.isCapturing();
    if (!capturingResult.capturing) {
        return;
    }

    // Check buffer size first
    const sizeResult = await window.electronAPI.systemAudio.getBufferSize();
    if (!sizeResult.size || sizeResult.size < 3200) { // At least 0.1 seconds
        return;
    }

    setTranscribing(true);
    updateStatus('🔊 Transcribing system audio...', 'recording');

    try {
        // Get WAV audio data from Main Process
        const audioResult = await window.electronAPI.systemAudio.getAudio();

        if (!audioResult.audio || audioResult.audio.length === 0) {
            setTranscribing(false);
            return;
        }

        // Send to transcription API
        const result = await window.electronAPI.transcribeAudio(audioResult.audio);

        if (result.text && !result.error) {
            setFullTranscription(result.text);
            showTranscription(state.fullTranscription + ' ▌');
        } else if (result.error) {
            console.error('Transcription error:', result.error);
        }

        updateStatus('🔊 Capturing system audio...', 'recording');
    } catch (error) {
        console.error('[SystemAudio] Transcription failed:', error);
    } finally {
        setTranscribing(false);
    }
}

/**
 * Finalize Linux system audio recording
 */
export async function finalizeLinuxSystemAudio() {
    updateStatus('Processing final audio...', 'processing');

    // Set finalizing flag to prevent intermediate transcriptions
    setFinalizing(true);

    // Wait for any ongoing transcription to finish
    let waitCount = 0;
    while (state.isTranscribing && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
    }

    try {
        // Small delay to ensure last audio chunks are in the buffer
        await new Promise(resolve => setTimeout(resolve, 150));

        // Get ALL audio from buffer and clear it (final transcription)
        const audioResult = await window.electronAPI.systemAudio.getAudioFinal();

        // Now stop capture AFTER getting all audio
        await window.electronAPI.systemAudio.stopCapture();

        if (audioResult.audio && audioResult.audio.length > 0) {
            // Transcribe final audio (this is the complete audio)
            const result = await window.electronAPI.transcribeAudio(audioResult.audio);

            if (result.text && !result.error) {
                setFullTranscription(result.text);
            } else if (result.error) {
                console.error('[SystemAudio] Transcription error:', result.error);
            }
        }

    } catch (error) {
        console.error('[SystemAudio] Error getting final audio:', error);
        // Ensure capture is stopped even on error
        await window.electronAPI.systemAudio.stopCapture();
    } finally {
        setTranscribing(false);
        setFinalizing(false);
    }

    // Show transcription result
    if (state.fullTranscription) {
        showTranscription(state.fullTranscription);

        // Get AI response if we have transcription
        showResponse(''); // Clear previous response
        updateStatus('Getting AI response...', 'processing');
        try {
            const aiResult = await window.electronAPI.getAIResponse(state.fullTranscription);

            if (handleApiError(aiResult)) return;

            showResponse(aiResult.response);
            updateStatus('Done', 'idle');

            // Update History
            updateHistory(state.fullTranscription, aiResult.response);
        } catch (error) {
            console.error('AI response error:', error);
            updateStatus('Error', 'error');
        }
    } else {
        updateStatus('Ready', 'ready');
    }
}
