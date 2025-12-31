/**
 * System Audio Capture Module
 * Captures system audio using PulseAudio/PipeWire monitor devices on Linux
 * 
 * Strategy: Store audio in memory buffer, renderer fetches when needed
 */

const { spawn } = require('child_process');

let captureProcess = null;
let audioBuffer = [];  // Stores all captured audio bytes
let sampleRateUsed = 16000;

/**
 * List available audio devices using pactl
 * @returns {Promise<Array>} List of audio devices
 */
async function listAudioDevices() {
    return new Promise((resolve, reject) => {
        const pactl = spawn('pactl', ['list', 'sources', 'short']);
        let output = '';
        let error = '';

        pactl.stdout.on('data', (data) => {
            output += data.toString();
        });

        pactl.stderr.on('data', (data) => {
            error += data.toString();
        });

        pactl.on('close', (code) => {
            if (code !== 0) {
                console.error('[SystemAudio] pactl error:', error);
                resolve([]);
                return;
            }

            const devices = [];
            const lines = output.trim().split('\n');
            
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const id = parts[0].trim();
                    const name = parts[1].trim();
                    const isMonitor = name.toLowerCase().includes('monitor');
                    
                    devices.push({
                        id: id,
                        name: name,
                        isMonitor: isMonitor,
                        displayName: formatDeviceName(name)
                    });
                }
            }

            console.log('[SystemAudio] Found devices:', devices.length);
            resolve(devices);
        });

        pactl.on('error', (err) => {
            console.error('[SystemAudio] Failed to run pactl:', err);
            resolve([]);
        });
    });
}

/**
 * Format device name for display
 */
function formatDeviceName(name) {
    return name
        .replace('alsa_output.', '')
        .replace('alsa_input.', '')
        .replace('.monitor', ' (Monitor)')
        .replace('.analog-stereo', '')
        .replace('.hdmi-stereo', ' HDMI')
        .replace('pci-0000_', '')
        .replace('usb-', '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Start capturing audio from a specific device
 * Audio is stored in internal buffer, not streamed
 * @param {string} deviceName - The PulseAudio device name
 * @param {number} sampleRate - Sample rate (default 16000 for Whisper)
 * @returns {boolean} Success status
 */
function startCapture(deviceName, sampleRate = 16000) {
    if (captureProcess) {
        console.log('[SystemAudio] Stopping existing capture...');
        stopCapture();
    }

    console.log('[SystemAudio] Starting capture from:', deviceName);
    console.log('[SystemAudio] Sample rate:', sampleRate);

    // Reset buffer
    audioBuffer = [];
    sampleRateUsed = sampleRate;

    // Use parec (PulseAudio recording) to capture audio
    // Output: raw PCM, 16-bit signed little-endian, mono
    // --latency-msec=10 for low latency capture (faster start)
    // --process-time-msec=5 for quick processing
    captureProcess = spawn('parec', [
        '--device=' + deviceName,
        '--rate=' + sampleRate,
        '--channels=1',
        '--format=s16le',
        '--latency-msec=10',
        '--process-time-msec=5'
    ]);

    let byteCount = 0;
    let startTime = Date.now();
    console.log('[SystemAudio] Capture process started at:', startTime);
    
    captureProcess.stdout.on('data', (data) => {
        // Log first data received
        if (byteCount === 0) {
            console.log('[SystemAudio] First audio data received after:', Date.now() - startTime, 'ms');
        }
        // Store audio data in buffer
        for (let i = 0; i < data.length; i++) {
            audioBuffer.push(data[i]);
        }
        byteCount += data.length;
        
        // Log periodically (every ~10 seconds)
        if (byteCount < 10000 || byteCount % 320000 === 0) {
            const seconds = (byteCount / (sampleRate * 2)).toFixed(1);
            console.log('[SystemAudio] Captured', seconds, 'seconds of audio');
        }
    });

    captureProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('Time:')) {
            console.error('[SystemAudio] parec stderr:', msg);
        }
    });

    captureProcess.on('close', (code) => {
        console.log('[SystemAudio] Capture process ended with code:', code);
        captureProcess = null;
    });

    captureProcess.on('error', (err) => {
        console.error('[SystemAudio] Failed to start parec:', err);
        captureProcess = null;
    });

    return true;
}

/**
 * Stop audio capture
 */
function stopCapture() {
    if (captureProcess) {
        console.log('[SystemAudio] Stopping capture...');
        captureProcess.kill('SIGTERM');
        captureProcess = null;
    }
}

/**
 * Get the captured audio data (keeps buffer intact for continuous recording)
 * Returns audio as WAV format bytes
 */
function getAudioData() {
    if (audioBuffer.length === 0) {
        return null;
    }

    console.log('[SystemAudio] Getting', audioBuffer.length, 'bytes of audio (keeping buffer)');
    
    // Convert buffer to WAV format - don't clear, keep accumulating
    const wavData = pcmToWav(audioBuffer, sampleRateUsed, 1, 16);
    
    return Array.from(wavData);
}

/**
 * Get audio data AND clear the buffer (for final transcription)
 */
function getAudioDataAndClear() {
    if (audioBuffer.length === 0) {
        return null;
    }

    console.log('[SystemAudio] Getting', audioBuffer.length, 'bytes of audio (clearing buffer)');
    
    const wavData = pcmToWav(audioBuffer, sampleRateUsed, 1, 16);
    
    // Clear buffer after getting data
    audioBuffer = [];
    
    return Array.from(wavData);
}

/**
 * Clear the audio buffer
 */
function clearBuffer() {
    audioBuffer = [];
    console.log('[SystemAudio] Buffer cleared');
}

/**
 * Get audio buffer size (for checking if there's audio)
 */
function getBufferSize() {
    return audioBuffer.length;
}

/**
 * Check if capture is active
 */
function isCapturing() {
    return captureProcess !== null;
}

/**
 * Convert raw PCM data to WAV format
 */
function pcmToWav(pcmData, sampleRate, channels, bitsPerSample) {
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    const buffer = Buffer.alloc(totalSize);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(totalSize - 8, 4);
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // PCM data
    for (let i = 0; i < pcmData.length; i++) {
        buffer[headerSize + i] = pcmData[i];
    }
    
    return buffer;
}

module.exports = {
    listAudioDevices,
    startCapture,
    stopCapture,
    getAudioData,
    getAudioDataAndClear,
    clearBuffer,
    getBufferSize,
    isCapturing
};
