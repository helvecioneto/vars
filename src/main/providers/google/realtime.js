const WebSocket = require('ws');

/**
 * Real-time transcription using Google Gemini Live API
 * Similar interface to OpenAI's RealtimeTranscription for consistency
 */
class GeminiRealtimeTranscription {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.ws = null;
        this.isConnected = false;
        this.transcriptionCallback = null;
        this.errorCallback = null;
        this.fullTranscript = '';
    }

    async connect() {
        return new Promise((resolve, reject) => {
            // Gemini Live API WebSocket endpoint - use gemini-2.0-flash-exp for Live API
            const model = 'gemini-2.0-flash-exp';
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

            let resolved = false;

            // Timeout after 10 seconds
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.disconnect();
                    reject(new Error('Connection timeout - Gemini Live API did not respond'));
                }
            }, 10000);

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                console.log('Gemini Live API connected');
                this.isConnected = true;

                // Send setup message to configure the session for transcription
                const setupMessage = {
                    setup: {
                        model: `models/${model}`,
                        generationConfig: {
                            responseModalities: ['TEXT']
                        },
                        // Enable input audio transcription
                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                disabled: false,
                                startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                                endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                                prefixPaddingMs: 300,
                                silenceDurationMs: 500
                            },
                            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
                            turnCoverage: 'TURN_INCLUDES_ALL_INPUT'
                        },
                        inputAudioTranscription: {}
                    }
                };

                this.ws.send(JSON.stringify(setupMessage));
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());

                    // Check for setupComplete to resolve the promise
                    if (message.setupComplete && !resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        console.log('Gemini Live setup complete');
                        resolve();
                    }

                    this.handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse Gemini Live message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('Gemini Live API WebSocket error:', error);
                this.isConnected = false;
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
                if (!resolved) {
                    clearTimeout(timeout);
                    resolved = true;
                    reject(error);
                }
            });

            this.ws.on('close', (code, reason) => {
                const reasonStr = reason?.toString() || 'Unknown reason';
                console.log('Gemini Live API disconnected:', code, reasonStr);
                this.isConnected = false;

                if (!resolved) {
                    clearTimeout(timeout);
                    resolved = true;
                    reject(new Error(`Connection closed: ${code} - ${reasonStr}`));
                }
            });
        });
    }

    handleMessage(message) {
        console.log('Gemini Live message:', JSON.stringify(message).substring(0, 200));

        // Handle setup complete
        if (message.setupComplete) {
            console.log('Gemini Live setup complete');
            return;
        }

        // Handle server content (transcription)
        if (message.serverContent) {
            const content = message.serverContent;

            // Check for input transcription (user's speech)
            if (content.inputTranscription) {
                const transcript = content.inputTranscription.text || '';
                if (transcript) {
                    this.fullTranscript = transcript;
                    const isFinal = content.turnComplete || false;

                    if (this.transcriptionCallback) {
                        this.transcriptionCallback(this.fullTranscript, isFinal);
                    }
                }
            }

            // Check for model parts (if any text response)
            if (content.modelTurn && content.modelTurn.parts) {
                for (const part of content.modelTurn.parts) {
                    if (part.text) {
                        console.log('Gemini model response:', part.text);
                    }
                }
            }
        }

        // Handle tool call (if any) - not used for transcription but log it
        if (message.toolCall) {
            console.log('Gemini tool call:', message.toolCall);
        }
    }

    sendAudio(audioBuffer) {
        if (!this.isConnected || !this.ws) {
            return;
        }

        // Convert buffer to base64
        const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
        const base64Audio = buffer.toString('base64');

        // Send realtime input with audio
        const audioMessage = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Audio
                }]
            }
        };

        this.ws.send(JSON.stringify(audioMessage));
    }

    commitAudio() {
        if (!this.isConnected || !this.ws) {
            return;
        }

        // Send end of turn signal
        const endMessage = {
            clientContent: {
                turnComplete: true
            }
        };

        this.ws.send(JSON.stringify(endMessage));
    }

    clearAudio() {
        this.fullTranscript = '';
    }

    onTranscription(callback) {
        this.transcriptionCallback = callback;
    }

    onError(callback) {
        this.errorCallback = callback;
    }

    getFullTranscript() {
        return this.fullTranscript.trim();
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }
}

module.exports = { GeminiRealtimeTranscription };
