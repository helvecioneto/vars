# VARS (Virtual Agent for Real-time Support)

AI assistant that listens to calls and provides knowledge-based answers, invisible to screen sharing.

## Features

- 🎧 **Audio Capture**: Capture system audio from calls using CTRL+Space hotkey
- 📝 **Real-time Transcription**: Transcribe audio using OpenAI Whisper API
- 🤖 **AI-Powered Responses**: Get intelligent answers based on your knowledge base
- � **Screen Capture & Analysis**: Capture and analyze the foreground application window
- 👻 **Invisible to Screen Sharing**: Window is protected from screen capture (macOS/Windows)
- ⚙️ **Configurable**: Set API key, model, system prompt, and knowledge base files

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

### Hotkeys

| Shortcut | macOS | Windows/Linux | Action |
|----------|-------|---------------|--------|
| Record | ⌥+Space | Ctrl+Space | Start/Stop audio recording |
| Mode Switch | ⌥+M | Ctrl+M | Switch between audio input modes |
| Screenshot | ⌥+Shift+S | Ctrl+Shift+S | Capture and analyze screen |
| History | ⌥+↑/↓ | Ctrl+↑/↓ | Navigate conversation history |
| Zoom In | ⌥++ | Ctrl++ | Increase interface size |
| Zoom Out | ⌥+- | Ctrl+- | Decrease interface size |
| Reset Zoom | ⌥+0 | Ctrl+0 | Reset interface size |

### Screen Capture Feature

The screen capture feature allows you to:
1. Press the screenshot button or use the keyboard shortcut
2. The app captures the **foreground application** (not the VARS window itself)
3. The captured image is sent to the AI for analysis
4. You can optionally type a question in the input field before capturing
5. The AI will analyze the screenshot and respond based on your question

**Note for Linux users**: The screen capture feature requires `xdotool`, `wmctrl`, or `xprop` to be installed for detecting the foreground window. Install with:
```bash
# Ubuntu/Debian
sudo apt install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

### Configuration

1. Click the ⚙️ settings button
2. Enter your OpenAI API key
3. Select the GPT model
4. Customize the system prompt
5. Add knowledge base files (txt, md, json)
6. Save settings

## Requirements

- Node.js 18+
- OpenAI API key
- macOS 10.15+ / Windows 10+ / Linux (note: screen protection doesn't work on Linux)

## Development

```bash
npm run dev
```

## License

MIT
