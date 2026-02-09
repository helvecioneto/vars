/**
 * VARS - Recording Coordinator Module
 * Coordinates audio recording lifecycle
 */

import { state, setRecording, setMediaRecorder, setAudioChunks, setFullTranscription, setTranscribing, setFinalizing, setTranscriptionInterval, setRealtimeActive, setAudioContext, setScriptProcessor } from '../state/index.js';
import { updateStatus, updateRecordingUI } from '../ui/status.js';
import { showTranscription, showResponse } from '../ui/response.js';
import { handleApiError, showQuotaError } from '../utils/api-errors.js';
import { updateHistory } from '../history/index.js';

import { captureSystemAudio } from './audio.js';
import { transcribeCurrentAudio, transcribeLinuxSystemAudio, finalizeLinuxSystemAudio } from './transcription.js';

/**
 * Handle recording toggle button click or shortcut
 * @param {boolean} recording - Target recording state
 */
export async function handleRecordingToggle(recording) {
    setRecording(recording);

    if (state.isRecording) {
        startRecording();
    } else {
        stopRecording();
    }

    updateRecordingUI();
}

/**
 * Start the recording process
 */
export async function startRecording() {
    // Skip if in keyboard mode
    if (state.currentInputMode === 'keyboard') {
        return;
    }

    try {
        const provider = state.config.provider || 'openai';
        const sampleRate = provider === 'google' ? 16000 : 24000;
        let stream;
        let audioTracks;

        // Check if this is Linux system audio (special handling required)
        // const isLinuxSystemAudio = state.currentInputMode === 'system' && window.electronAPI.platform === 'linux';

        if (state.currentInputMode === 'system') {
            // Capture system/computer audio
            stream = await captureSystemAudio(sampleRate);

            if (!stream) {
                throw new Error('Failed to capture system audio.');
            }

            audioTracks = stream.getAudioTracks();

            // Stop video tracks if any (we only need audio)
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach(track => track.stop());

            if (audioTracks.length === 0 && !stream._isLinuxSystemAudio) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('No audio captured. Make sure to enable "Share audio" when selecting the screen/window.');
            }

            console.log('Capturing system audio:', audioTracks[0]?.label || 'Linux PulseAudio');
        } else {
            // Capture microphone audio using getUserMedia
            const deviceId = state.config.inputDeviceId !== 'default' ? state.config.inputDeviceId : undefined;
            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                    sampleRate: sampleRate
                }
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            audioTracks = stream.getAudioTracks();

            if (audioTracks.length === 0) {
                throw new Error('No audio input device found');
            }

            console.log('Using microphone:', audioTracks[0].label);
        }

        // Reset state
        setFullTranscription('');
        setAudioChunks([]);
        setTranscribing(false);
        setFinalizing(false);
        showTranscription(state.currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Listening...');

        // Handle Linux system audio differently (no MediaRecorder)
        if (stream._isLinuxSystemAudio) {
            // Store the stream for cleanup and data access
            window._linuxSystemAudioStream = stream;

            // For Linux system audio, we'll transcribe the PCM data directly
            // Set up periodic transcription
            const interval = setInterval(async () => {
                if (state.isRecording && !state.isTranscribing) {
                    await transcribeLinuxSystemAudio();
                }
            }, 3000);
            setTranscriptionInterval(interval);

            const statusMsg = '🔊 Capturing system audio...';
            updateStatus(statusMsg, 'recording');
            return;
        }

        const audioStream = new MediaStream(audioTracks);
        const mimeType = 'audio/webm;codecs=opus';
        
        const mediaRecorder = new MediaRecorder(audioStream, { mimeType });
        setMediaRecorder(mediaRecorder);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (state.transcriptionInterval) {
                clearInterval(state.transcriptionInterval);
                setTranscriptionInterval(null);
            }
            await finalizeRecording();
        };

        mediaRecorder.start(1000);

        // Batch transcription mode (every 2 seconds)
        const interval = setInterval(async () => {
            if (state.isRecording && state.audioChunks.length > 0 && !state.isTranscribing) {
                await transcribeCurrentAudio();
            }
        }, 2000);
        setTranscriptionInterval(interval);

        const statusMsg = state.currentInputMode === 'system' ? '🔊 Capturing system audio...' : '🎙️ Recording...';
        updateStatus(statusMsg, 'recording');

    } catch (error) {
        console.error('Failed to start recording:', error);
        updateStatus('Error starting recording: ' + error.message, 'error');
        setRecording(false);
        updateRecordingUI();
    }
}

/**
 * Stop the recording process
 */
export function stopRecording() {
    // Clear transcription interval
    if (state.transcriptionInterval) {
        clearInterval(state.transcriptionInterval);
        setTranscriptionInterval(null);
    }

    // Stop realtime streaming
    if (state.realtimeActive) {
        setRealtimeActive(false);
        window.electronAPI.realtimeStop();
    }

    // Clear realtime send interval
    if (window._realtimeSendInterval) {
        clearInterval(window._realtimeSendInterval);
        window._realtimeSendInterval = null;
    }

    // Cleanup Linux system audio
    if (window._linuxSystemAudioStream) {
        // const stream = window._linuxSystemAudioStream; // unused
        window._linuxSystemAudioStream = null;

        // Do final transcription FIRST (before stopping capture)
        // This ensures all audio is collected before parec is killed
        finalizeLinuxSystemAudio();
        return; // Skip the rest, finalizeLinuxSystemAudio handles cleanup
    }

    // Cleanup AudioContext
    if (state.scriptProcessor) {
        state.scriptProcessor.disconnect();
        setScriptProcessor(null);
    }
    if (state.audioContext) {
        state.audioContext.close();
        setAudioContext(null);
    }

    // Stop MediaRecorder and cleanup stream
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
        const stream = state.mediaRecorder.stream;

        // Call cleanup function if this is a Linux system audio stream
        if (stream._cleanup) {
            stream._cleanup();
        }

        stream.getTracks().forEach(track => track.stop());
    }

    updateStatus('Processing...', 'processing');
}

/**
 * Finalize recording (non-Linux)
 */
export async function finalizeRecording() {
    if (state.audioChunks.length === 0) {
        updateStatus('No audio recorded', 'error');
        return;
    }

    try {
        updateStatus('Finalizing transcription...', 'processing');

        // Final transcription of all audio
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = new Uint8Array(arrayBuffer);

        const transcriptionResult = await window.electronAPI.transcribeAudio(Array.from(audioBuffer));

        if (transcriptionResult.error) {
            if (transcriptionResult.isQuotaError) {
                showQuotaError();
            } else {
                showTranscription(`Error: ${transcriptionResult.error}`);
                updateStatus('Transcription failed', 'error');
            }
            return;
        }

        setFullTranscription(transcriptionResult.text);
        showTranscription(state.fullTranscription);

        // Get AI response
        showResponse(''); // Clear previous response so it doesn't persist while loading
        updateStatus('Getting AI response...', 'processing');

        const aiResult = await window.electronAPI.getAIResponse(state.fullTranscription);

        if (handleApiError(aiResult)) return;

        showResponse(aiResult.response);
        updateStatus('Done', 'idle');

        // Update History
        updateHistory(state.fullTranscription, aiResult.response);

    } catch (error) {
        console.error('Finalize recording error:', error);
        updateStatus('Error: ' + error.message, 'error');
    }
}
