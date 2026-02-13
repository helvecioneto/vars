<div align="center">

# VARS (Virtual Agent for Real-time Support)

[![GitHub release](https://img.shields.io/github/v/release/helvecioneto/vars?style=flat-square)](https://github.com/helvecioneto/vars/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-❤️-ea4aaa?style=flat-square)](https://github.com/sponsors/helvecioneto)

**AI-powered assistant that listens to your calls and provides intelligent, knowledge-based answers — completely invisible to screen sharing.**

🌐 **[Visit our Website](https://helvecioneto.github.io/vars/)** • [Download](#-download) • [Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Donate](#-support-the-project)

<img src="docs/img/main.png" alt="VARS Application Screenshot" width="480">

</div>

---

## 💡 Motivation / Motivação

The motivation behind this project came from observing the growing popularity of Desktop Virtual Agents designed to assist candidates during job interviews. However, most of these tools are either paid or have limited features. This inspired me to create a free and accessible solution, recognizing that many job seekers—especially in developing countries like Brazil—may not have the financial means to afford expensive services while searching for employment.

Additionally, this project aims to accelerate changes in recruitment processes. Current selection methodologies often suffer from structural flaws, eliminating excellent candidates while selecting those who merely fit a "non-human" or artificial standard. By leveling the playing field, we hope to encourage a shift towards more authentic and effective evaluation methods.

---

A motivação para criar este projeto surgiu ao observar a crescente popularização de Agentes Virtuais de Desktop projetados para auxiliar candidatos em entrevistas de emprego. No entanto, a maioria dessas ferramentas é paga ou possui recursos limitados. Isso me inspirou a desenvolver uma solução gratuita e acessível, pois entendo que muitos candidatos, especialmente em países em desenvolvimento como o Brasil, podem não ter condições financeiras para arcar com custos elevados enquanto buscam uma oportunidade no mercado de trabalho.

Além disso, este projeto visa acelerar mudanças nos processos seletivos. As metodologias de seleção atuais muitas vezes sofrem de falhas estruturais, eliminando excelentes candidatos enquanto selecionam aqueles que apenas se encaixam em um padrão "não humano" ou artificial. Ao nivelar o campo de jogo, esperamos incentivar uma mudança em direção a métodos de avaliação mais autênticos e eficazes.

---

## 📥 Download

### Pre-built Binaries

Download the latest version for your operating system from the [Releases page](https://github.com/helvecioneto/vars/releases):

| Platform | Architecture | Download |
|----------|-------------|----------|
| **Windows** | x64 | [VARS-win-x64.exe](https://github.com/helvecioneto/vars/releases/latest/download/VARS-win-x64.exe) |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | [VARS-mac-arm64.dmg](https://github.com/helvecioneto/vars/releases/latest/download/VARS-mac-arm64.dmg) |
| **macOS** | Intel | [VARS-mac-x64.dmg](https://github.com/helvecioneto/vars/releases/latest/download/VARS-mac-x64.dmg) |
| **Linux** | x64 | [VARS-linux-x64.AppImage](https://github.com/helvecioneto/vars/releases/latest/download/VARS-linux-x64.AppImage) |

---

## ✨ Features

### 🔐 Flexible Authentication
- **OpenAI OAuth**: Login with your ChatGPT Plus/Pro account — no API key needed
- **OpenAI API Key**: Direct API key for full control
- **Google Gemini API Key**: Free tier available with generous limits
- Seamless switching between connection modes

### 🤖 Multi-Provider AI Support
- **OpenAI**: GPT-4o-mini (Fast), GPT-4o (Balanced), GPT-5.2 (Quality)
- **Google Gemini**: Gemini 3.0 Flash/Pro, Gemini 2.5 Flash/Pro with free tier
- **4 Quality Tiers**: Free, Fast, Balanced, and Quality — each with optimized parameters
- **Smart Retry**: Automatic model fallback with exponential backoff (free tier)

### 🎙️ Transcription Engine
- **Local Whisper (Free, Offline)**: Built-in whisper.cpp via `@napi-rs/whisper` — no internet required
  - Models: Tiny (75 MB), Base (142 MB), Small (466 MB, recommended), Medium (1.5 GB)
  - Download and manage models directly from settings
  - Automatic audio conversion via ffmpeg
- **Cloud OpenAI**: Whisper-1 API for high-accuracy transcription
- **Cloud Gemini**: Google Gemini models for transcription
- **Real-time Transcription**: Live audio streaming via OpenAI Realtime API or Gemini Live API

### 🎧 Audio Capture Modes
- **System Audio**: Capture audio from calls, meetings, and any application
  - macOS/Windows: Electron loopback capture
  - Linux: PulseAudio/PipeWire via `parec`
- **Microphone Input**: Direct microphone recording with device selection
- Toggle between modes with a keyboard shortcut

### 📸 Screen Capture & Analysis
- Captures the **foreground application window** (not the VARS window)
- Cross-platform: Windows (Win32 API), macOS (Core Graphics), Linux (auto-detects `gnome-screenshot`, `spectacle`, `scrot`)
- Quick actions after capture:
  - **Answers** — Find and answer questions visible on screen
  - **Code** — Analyze and explain code
  - **Summary** — Summarize visible content
  - **Custom Question** — Ask anything about the captured image
- AI-powered image analysis via OpenAI Vision or Google Gemini Vision

### 📚 Knowledge Base
- Upload documents: `.pdf`, `.txt`, `.docx`, `.md`
- AI uses your files to provide contextual, grounded answers
- **OpenAI**: Powered by Assistants API with Vector Store
- **Google**: Powered by File Search Store
- Add, index ("Fit"), and clear files from the settings UI

### 👻 Privacy & Stealth
- **Invisible to Screen Sharing**: Content protection on macOS and Windows (`setContentProtection`)
- **Always-on-Top**: Floats above other windows without interfering
- **System Tray**: Runs quietly in background with Show/Hide toggle
- **Frameless Design**: Minimal, non-intrusive transparent window
- **Toggleable Visibility**: Switch content protection on/off as needed

### 🖱️ Click-Through Mode
- **Pass-Through Interaction**: Enable click-through to interact with applications behind VARS while keeping it visible
- **Global Hotkey**: Toggle instantly with keyboard shortcut (macOS: `⌥+T`, Windows/Linux: `Ctrl+Alt+T`)
- **Toolbar Button**: Quick access via dedicated button next to History
- **Smart Control**: Hold `Ctrl` to temporarily interact with VARS while in click-through mode (macOS/Windows)
- **Visual Feedback**: Elegant purple glow indicates when click-through is active
- **Multi-Window Support**: Works on both main and response windows
- **Perfect for Overlays**: Keep VARS visible at the top of your screen while working on other tasks

### ✨ AI Prompt Tools
- **Custom System Prompt**: Define how the AI responds
- **Prompt Optimizer**: AI-powered tool that transforms your instructions into a professional, well-structured system prompt
- **Brief Mode**: Ultra-short responses (1-2 sentences) — ideal for live situations

### 🌍 Multi-Language Support
- Interface and responses in **English**, **Português (BR)**, and **Español**
- Language-aware transcription and AI responses
- Multilingual system prompts and onboarding

### 🎓 Guided Onboarding
- 8-step interactive tutorial on first launch
- Auto-navigates through settings tabs
- Highlights each configuration area with clear instructions

### ⌨️ Keyboard-First Design
- Global hotkeys work even when VARS is in background
- Text input for keyboard-only workflow
- Conversation history navigation with arrow keys
- Zoom controls (70%–130%)

### 🔄 Auto-Update
- Automatic check for new versions on startup
- Manual check via "About" tab
- Direct link to download new releases from GitHub

---

## 🛠️ Installation

### Prerequisites

- **Node.js** 18.0 or higher ([Download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **One of the following** for AI access:
  - OpenAI account (ChatGPT Plus/Pro) for OAuth login — no API key needed
  - [OpenAI API Key](https://platform.openai.com/api-keys) for direct access
  - [Google AI Studio API Key](https://aistudio.google.com/app/apikey) — free tier available

### Install from Source

```bash
# Clone the repository
git clone https://github.com/helvecioneto/vars.git
cd vars

# Install dependencies
npm install

# Start the application
npm start

# Or start in development mode (with DevTools)
npm run dev
```

### Platform-Specific Requirements

<details>
<summary><b>🍎 macOS</b></summary>

- macOS 10.15 (Catalina) or later
- Microphone permission required (system will prompt)
- Screen Recording permission required for screen capture

</details>

<details>
<summary><b>🪟 Windows</b></summary>

- Windows 10 or later
- No additional permissions required

</details>

<details>
<summary><b>🐧 Linux</b></summary>

- X11 or Wayland with XWayland
- **Screen capture** requires one of: `gnome-screenshot`, `spectacle` (KDE), `scrot`, or `import` (ImageMagick)
- **System audio** requires PulseAudio or PipeWire with `parec`

```bash
# Ubuntu/Debian
sudo apt install xdotool pulseaudio-utils

# Fedora
sudo dnf install xdotool pulseaudio-utils

# Arch
sudo pacman -S xdotool pulseaudio
```

> ⚠️ **Note**: Screen protection (invisible to screen sharing) does not work on Linux.

</details>

---

## 📖 Usage

### First Launch

1. Launch VARS (`npm start` or double-click the app)
2. The **onboarding tour** will guide you through initial setup
3. Choose your **Connection** mode (OAuth, OpenAI API Key, or Gemini API Key)
4. Select an AI **Model** preset
5. Choose a **Transcription** engine (Local Whisper recommended for free offline use)
6. (Optional) Add knowledge base files and click **Fit**
7. You're ready to go!

### Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| **Start/Stop Recording** | `⌥ + Space` | `Ctrl + Space` |
| **Switch Audio Mode** | `⌥ + M` | `Ctrl + M` |
| **Screenshot Capture** | `⌥ + Shift + S` | `Ctrl + Shift + S` |
| **Toggle Click-Through** | `⌥ + T` | `Ctrl + Alt + T` |
| **Increase Opacity** | `⌥ + ]` | `Ctrl + Alt + ]` |
| **Decrease Opacity** | `⌥ + [` | `Ctrl + Alt + [` |

### Audio Recording Workflow

1. Press `Ctrl+Space` (or `⌥+Space` on Mac) to **start recording**
2. Speak or let the system audio play
3. Press the same shortcut to **stop recording**
4. VARS will transcribe and send to AI for analysis
5. View the response in the floating window

### Screen Capture Workflow

1. Focus the application you want to capture
2. Press `Ctrl+Shift+S` (or `⌥+Shift+S` on Mac)
3. Select an action: **Answers**, **Code**, **Summary**, or type a **Custom Question**
4. VARS captures the window and analyzes it with AI

### Click-Through Mode Workflow

1. Press `Ctrl+Alt+T` (or `⌥+T` on Mac) or click the **cursor icon** button in the toolbar
2. Notice the **purple glow** around the window border indicating click-through is active
3. Click anywhere to interact with applications behind VARS
4. **To interact with VARS**: Hold `Ctrl` key (macOS/Windows) — the window becomes interactive while held
5. Toggle the shortcut again to disable click-through mode

**Use Cases:**
- Position VARS at the top of your screen for constant AI availability while coding
- Keep the response window visible on a second monitor for reference
- Monitor transcriptions while interacting with other applications

### Text Input

- Type directly in the input field ("Ask me anything...")
- Press **Enter** to send to AI
- Use `Ctrl+↑/↓` to navigate conversation history

---

## 🏗️ Building from Source

### Quick Build

```bash
# Install dependencies first
npm install

# Build for your current platform
npm run build
```

### Platform-Specific Builds

#### Windows
```bash
npm run build:win

# Or using the batch script
.\scripts\build_win.bat
```

#### macOS
```bash
npm run build:mac

# Or using the shell script
./scripts/build_all.sh mac
```

#### Linux
```bash
npm run build:linux

# Or using the shell script
./scripts/build_all.sh linux
```

### Build Output

| Platform | Output Format |
|----------|--------------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` (separate builds for arm64 and x64) |
| Linux | `.AppImage` |

---

## ⚙️ Configuration

### Settings Tabs

| Tab | Description |
|-----|-------------|
| **IA** | Connection mode, API keys, Model preset, Transcription engine, Local Whisper management |
| **Behavior** | Language, Brief Mode, System Prompt with AI Optimizer |
| **Knowledge** | Upload and manage knowledge base files (.pdf, .txt, .docx, .md) |
| **Audio** | Microphone and system audio device selection |
| **Interface** | Window opacity control (20%–100%) |
| **About** | Version info, update checker, donation links |

### Providers & Models

| Provider | Tier | Model | Max Tokens |
|----------|------|-------|------------|
| **OpenAI** | Fast | `gpt-4o-mini` | 1,024 |
| **OpenAI** | Balanced | `gpt-4o` | 4,096 |
| **OpenAI** | Quality | `gpt-5.2` | 16,384 |
| **Google** | Free | `gemini-3-flash-preview` + fallbacks | 2,048 |
| **Google** | Fast | `gemini-3-flash-preview` | 4,096 |
| **Google** | Balanced | `gemini-2.5-flash` | 8,192 |
| **Google** | Quality | `gemini-3-pro-preview` | 8,192 |

### Local Whisper Models

| Model | Size | Notes |
|-------|------|-------|
| Tiny | 75 MB | Fastest, lower accuracy |
| Base | 142 MB | Good balance for simple audio |
| **Small** | **466 MB** | **Recommended** — best accuracy/size ratio |
| Medium | 1.5 GB | Best accuracy, slower |

### Configuration Storage

- **Settings**: `~/.vars/config.json`
- **Whisper Models**: `~/.vars/models/`
- **OAuth Credentials**: `~/.codex/auth.json` + macOS Keychain

---

## 🗂️ Project Structure

```
vars/
├── src/
│   ├── preload.js                # Context bridge (Electron IPC)
│   ├── assets/                   # Icons, QR images
│   ├── config/
│   │   ├── models.json           # AI model definitions per provider/tier
│   │   └── prompts.json          # System prompts (EN, PT-BR, ES)
│   ├── main/
│   │   ├── index.js              # App entry point, window, tray, shortcuts
│   │   ├── config.js             # Config load/save/migration
│   │   ├── ipc-handlers.js       # IPC handler registration
│   │   ├── screen-capture.js     # Cross-platform screen capture
│   │   ├── system-audio.js       # System audio capture (PulseAudio/loopback)
│   │   ├── handlers/
│   │   │   ├── ai.js             # AI responses, image analysis, KB, prompt optimizer
│   │   │   ├── audio.js          # Transcription, realtime, whisper management
│   │   │   ├── config.js         # Config IPC handlers
│   │   │   ├── media.js          # Media-related handlers
│   │   │   ├── misc.js           # Miscellaneous handlers
│   │   │   └── window.js         # Window management
│   │   └── providers/
│   │       ├── openai/           # Chat, vision, transcription, assistants, realtime, OAuth
│   │       ├── google/           # Chat, vision, transcription, KB, realtime
│   │       ├── local/            # Local Whisper: whisper.cpp bindings, model manager
│   │       └── shared/           # Retry utilities with fallback
│   └── renderer/
│       ├── index.html            # Main UI
│       ├── main.js               # Renderer entry point
│       ├── events/               # Event handlers
│       ├── history/              # Conversation history
│       ├── input/                # Text input handling
│       ├── onboarding/           # Guided first-run tutorial
│       ├── recording/            # Audio capture & transcription
│       ├── screenshot/           # Screenshot UI
│       ├── settings/             # Settings tabs (API, auto-save, devices, KB, whisper, etc.)
│       ├── state/                # Centralized app state
│       ├── styles/               # CSS modules
│       ├── ui/                   # UI components (response, status, tooltips, zoom, visibility)
│       └── utils/                # Error handling, formatting, bounds
├── scripts/                      # Build scripts (macOS/Linux/Windows)
├── build/                        # Build resources (entitlements)
├── docs/                         # Website files
├── package.json                  # Dependencies & build config
└── README.md
```

---

## 🔧 Troubleshooting

<details>
<summary><b>Recording doesn't work</b></summary>

- **macOS**: Grant microphone permission in System Preferences → Privacy & Security → Microphone
- **Linux**: Ensure PulseAudio/PipeWire is running: `pulseaudio --check`
- Check the audio device selection in Settings → Audio tab

</details>

<details>
<summary><b>Screen capture shows wrong window</b></summary>

- VARS captures the **foreground window**, not the window under cursor
- Make sure the target window is focused before pressing the shortcut
- On Linux, ensure `gnome-screenshot`, `spectacle`, or `scrot` is installed

</details>

<details>
<summary><b>AI responses are slow</b></summary>

- Switch to a faster model preset (Fast instead of Quality)
- Google Gemini free tier may have rate limits — consider using an API key
- Check your internet connection

</details>

<details>
<summary><b>"API key not configured" error</b></summary>

- Open Settings (⚙️) → IA tab
- Choose a connection type and enter credentials
- If using OAuth, click Login and authenticate in the browser
- If using API key, paste your key and click Test

</details>

<details>
<summary><b>Local Whisper not working</b></summary>

- Make sure you downloaded a model in Settings → IA tab → Whisper section
- The "Small" model (466 MB) is recommended for best accuracy
- If you get errors, try deleting and re-downloading the model

</details>

---

## 💖 Support the Project

If VARS helps you in your daily work, consider supporting its development!

### GitHub Sponsors

[![Sponsor](https://img.shields.io/badge/Sponsor_on_GitHub-❤️-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/helvecioneto)

Your sponsorship helps:
- 🚀 Develop new features
- 🐛 Fix bugs faster
- 📚 Improve documentation
- ☕ Keep the developer caffeinated

### Other Ways to Support

- ⭐ **Star this repository** to help others discover VARS
- 🐛 **Report bugs** and suggest features via [Issues](https://github.com/helvecioneto/vars/issues)
- 🔀 **Contribute code** via [Pull Requests](https://github.com/helvecioneto/vars/pulls)
- 📢 **Share** VARS with your colleagues and friends

---

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.

This license guarantees your freedom to share and change the software, ensuring it remains free software for all its users.

**Key Permissions:**
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use

**Conditions:**
- ℹ️ Disclose source
- ℹ️ License and copyright notice
- ℹ️ Same license (Copyleft)

**Disclaimer:**
This software is provided "as is", without warranty of any kind. Please see the [LICENSE](LICENSE) file for the full license text and important legal disclaimers regarding the use of recording features.

**Privacy & Open Source Transparency:**
Since this tool is Open Source, all privacy-related logic (audio and screen capture) can be verified directly in the source code. We encourage users to audit the code to ensure transparency and trust regarding how their data is handled.

---

<div align="center">

**Made with ❤️ for productive meetings**

[⬆ Back to Top](#-vars-virtual-agent-for-real-time-support)

</div>
