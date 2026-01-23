/**
 * VARS - Audio Capture Module
 * Handles capture of system and microphone audio
 */

import { state } from '../state/index.js';

/**
 * Capture system audio using PulseAudio/PipeWire monitor devices (Linux)
 * or desktopCapturer (Windows/macOS)
 * @param {number} sampleRate - The desired sample rate
 * @returns {Promise<MediaStream|null>} The captured audio stream
 */
export async function captureSystemAudio(sampleRate) {
    const platform = window.electronAPI.platform;

    // On Linux, use monitor devices directly
    if (platform === 'linux') {
        return await captureLinuxSystemAudio(sampleRate);
    }

    // On Windows/macOS, use desktopCapturer
    return await captureDesktopAudio(sampleRate);
}

/**
 * Capture system audio on Linux using PulseAudio/PipeWire monitor devices
 * Audio is captured in Main Process, we just start/stop and fetch data
 * Returns a mock stream object with the necessary interface
 */
export async function captureLinuxSystemAudio(sampleRate) {
    const deviceName = state.config.systemAudioDeviceId;

    if (!deviceName) {
        throw new Error('No audio device configured.\n\nPlease go to Settings > Audio and:\n1. Click the refresh button\n2. Select a device from "System Audio (Monitors)"');
    }

    try {
        // Start capture in Main Process - audio is stored there
        const result = await window.electronAPI.systemAudio.startCapture(deviceName, sampleRate);

        if (result.error) {
            throw new Error(result.error);
        }

        // Create a mock MediaStream-like object
        const mockStream = {
            _isLinuxSystemAudio: true,
            _sampleRate: sampleRate,
            _deviceName: deviceName,
            getAudioTracks: () => [{
                label: 'Linux System Audio (' + deviceName.split('.')[0] + ')',
                stop: () => { },
                getSettings: () => ({ sampleRate: sampleRate, channelCount: 1 })
            }],
            getVideoTracks: () => [],
            getTracks: () => mockStream.getAudioTracks(),
            _cleanup: async () => {
                await window.electronAPI.systemAudio.stopCapture();
            }
        };

        return mockStream;

    } catch (error) {
        console.error('[SystemAudio] Capture failed:', error);
        throw error;
    }
}

/**
 * Capture desktop audio on Windows/macOS using desktopCapturer
 */
export async function captureDesktopAudio(sampleRate) {
    console.log('[SystemAudio] Starting captureDesktopAudio, platform:', window.electronAPI.platform);

    try {
        // On macOS, check screen recording permission first
        if (window.electronAPI.platform === 'darwin') {
            const permResult = await window.electronAPI.permissions.checkScreen();
            console.log('[SystemAudio] Screen permission status:', JSON.stringify(permResult));

            if (!permResult.granted) {
                const errorMsg = `Permissão de Gravação de Tela necessária.

Para capturar áudio do sistema no macOS:
1. Abra Ajustes do Sistema → Privacidade e Segurança
2. Vá em "Gravação do Áudio do Sistema e da Tela"
3. Ative o toggle para "VARS"
4. IMPORTANTE: Feche e reabra o VARS completamente

Status atual: ${permResult.status}`;

                await window.electronAPI.permissions.openSystemPreferences('screen');
                throw new Error(errorMsg);
            }
        }

        let stream;

        // Use getDisplayMedia - the main process handler will provide loopback audio
        console.log('[SystemAudio] Calling getDisplayMedia...');
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            console.log('[SystemAudio] getDisplayMedia returned');

        } catch (displayError) {
            console.error('[SystemAudio] getDisplayMedia failed:', displayError.name, displayError.message);

            // Fallback to getUserMedia with chromeMediaSource
            console.log('[SystemAudio] Falling back to getUserMedia...');

            const sources = await window.electronAPI.getDesktopSources();
            const screenSource = sources.find(s => s.id.startsWith('screen:'));

            if (!screenSource) {
                throw new Error('No screen source available');
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'desktop'
                        }
                    },
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: screenSource.id,
                            maxWidth: 1,
                            maxHeight: 1
                        }
                    }
                });
                console.log('[SystemAudio] getUserMedia succeeded');
                console.log('[SystemAudio] Audio tracks:', stream.getAudioTracks().length);
            } catch (mediaError) {
                console.error('[SystemAudio] getUserMedia failed:', mediaError.name, mediaError.message);

                if (window.electronAPI.platform === 'darwin') {
                    throw new Error(`Captura de áudio do sistema não disponível.

No macOS, tente:
1. Verificar se a permissão está ativada em Ajustes do Sistema
2. Reiniciar o VARS completamente (Cmd+Q)
3. Usar o modo Microfone (pressione Alt+M)

Erro técnico: ${mediaError.name}`);
                }
                throw mediaError;
            }
        }

        // Stop video tracks - we only need audio
        stream.getVideoTracks().forEach(track => {
            console.log('[SystemAudio] Stopping video track:', track.label);
            track.stop();
            stream.removeTrack(track);
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('System audio capture failed (no audio track)');
        }

        // Apply constraints to audio track (disable processing)
        const audioTrack = audioTracks[0];
        try {
            await audioTrack.applyConstraints({
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                sampleRate: sampleRate
            });
        } catch (e) {
            console.warn('Could not apply audio constraints:', e);
        }

        return stream;

    } catch (error) {
        console.error('[SystemAudio] Capture failed:', error);
        throw error;
    }
}
