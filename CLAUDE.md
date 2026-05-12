# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VARS (Virtual Agent for Real-time Support) is an Electron desktop app that listens to calls/meetings, transcribes audio, and generates AI answers. The window is designed to be invisible to screen sharing (macOS/Windows content protection). No test framework is configured.

## Commands

```bash
npm start              # Run the app (electron .)
npm run dev            # Run with DevTools detached (--dev flag)
npm run build          # electron-builder for current platform
npm run build:mac      # macOS .dmg
npm run build:win      # Windows .exe (NSIS)
npm run build:linux    # Linux .AppImage
npm run convert-icon   # Regenerate platform icons from src/assets/icon.png

./scripts/build_all.sh [mac|linux|all]   # Builds arm64 + x64 separately on macOS
.\scripts\build_win.bat                  # Windows build helper
```

Build output goes to `dist/`. macOS builds intentionally produce separate arm64 and x64 binaries instead of universal — see [scripts/build_all.sh](scripts/build_all.sh) — to avoid TCC permission issues with universal binaries.

## Architecture

### Two-process Electron split

- **Main process** ([src/main/](src/main/)) — runs Node.js, owns windows, IPC handlers, all network/filesystem/AI provider code, audio capture, screen capture, global shortcuts, tray.
- **Renderer process** ([src/renderer/](src/renderer/)) — runs in `BrowserWindow`, ES modules, `contextIsolation: true`, no `nodeIntegration`. Talks to main only through the `window.electronAPI` bridge exposed by [src/preload.js](src/preload.js).

The renderer never imports Electron or Node APIs directly — anything that needs them goes through `ipcRenderer.invoke` / `.send` via the preload bridge.

### Window topology

Three `BrowserWindow`s, all created in [src/main/index.js](src/main/index.js):

1. **Main window** — frameless, transparent, alwaysOnTop, ~35% screen width, top-center. Hosts the toolbar/settings UI.
2. **Response window** — separate frameless window positioned below the main window, hidden until a response arrives, opened lazily by the `show-in-response-window` IPC. Loads [src/renderer/response-window/](src/renderer/response-window/) with its own preload.
3. **Onboarding window** — small tooltip-style window for the first-run tutorial; uses `nodeIntegration: true` (unlike the others) because [src/renderer/onboarding/window.js](src/renderer/onboarding/window.js) uses `require` directly.

On macOS/Windows, all three call `setContentProtection(true)` to be invisible to screen-sharing software. This does not work on Linux.

### IPC handler organization

[src/main/ipc-handlers.js](src/main/ipc-handlers.js) is just a thin entry point. Real handlers live in [src/main/handlers/](src/main/handlers/) and are registered by [handlers/index.js](src/main/handlers/index.js) — `config`, `audio`, `ai`, `window`, `media`, `misc`, `smart-listener`, `onboarding`. When adding an IPC handler, place it in the matching domain module and (if exposed to the renderer) also expose it in [src/preload.js](src/preload.js).

Handlers receive a shared `context` object (`{ getMainWindow, getConfig, setConfig, ... }`) so they can read live config and reach the current window without module-level globals.

### Provider abstraction

[src/main/providers/](src/main/providers/) is split by backend:

- **openai/** — chat, vision, transcription (Whisper-1), assistants (vector store / knowledge base), realtime streaming, **codex-auth.js** (OAuth PKCE flow that lets users authenticate with their ChatGPT Plus/Pro account instead of an API key — reads/writes `~/.codex/auth.json` and macOS Keychain, mirrors the Codex CLI flow).
- **google/** — Gemini chat, vision, transcription, file-search-based knowledge base, realtime.
- **local/** — `@napi-rs/whisper` bindings + model manager (downloads models to `~/.vars/models/`).
- **shared/retry.js** — retry/fallback utility used by the Google "free" tier (which has a model fallback chain).

Each provider folder has an `index.js` that re-exports the public surface. The AI handler in [src/main/handlers/ai.js](src/main/handlers/ai.js) branches on `config.provider` (`openai` | `google`) and resolves the API key — preferring the Codex OAuth token when `config.useCodexAuth` is set (and never falling back to a stored API key in OAuth mode).

### Config-driven models and prompts

Models, tiers, and per-tier parameters (temperature, maxOutputTokens, topK/topP, retryConfig) are declared centrally in [src/config/models.json](src/config/models.json). Code should not hardcode model names — go through `getModelForTier(provider, tier, type)`, `getTierConfig(...)`, `getModelListForTier(...)`, or `getRetryConfig(...)` from [src/main/config.js](src/main/config.js).

System prompts are in [src/config/prompts.json](src/config/prompts.json), keyed by path and then language (`en`, `pt-br`, `es`). Access via `getPromptForLanguage(path, language)`.

### User config and migrations

User config lives at `~/.vars/config.json`. [src/main/config.js](src/main/config.js) `loadConfig()` runs a series of migrations on load — it derives newer fields (`connectionType`, `qualityPreset`, `transcriptionPreset`, `authMode`, `whisperModel`) from older legacy fields if they're missing. When adding a new config field with a default, also handle the migration case here so existing users don't break.

Two derived concepts that drive most of the UI:
- `qualityPreset` (e.g. `auth`, `openai-balanced`, `google-free`) maps to a `provider` + `tier` pair used for AI calls.
- `transcriptionPreset` (`local` | `auth` | `openai-api` | `google-api`) selects the transcription backend independently of the chat provider.

OAuth credentials live separately at `~/.codex/auth.json` (and macOS Keychain entry "Codex Auth"), not in the user config.

### Renderer state and modules

The renderer is plain ES modules loaded from [src/renderer/index.html](src/renderer/index.html), entry [src/renderer/main.js](src/renderer/main.js). There is no framework — DOM is manipulated directly. State is centralized in [src/renderer/state/index.js](src/renderer/state/index.js) as a single `state` object that all modules import and mutate. When adding renderer features, prefer extending `state` over module-scoped variables so other modules can read it.

Renderer subfolders are domain-scoped: `recording/`, `screenshot/`, `settings/`, `smart-listener/`, `onboarding/`, `response-window/`, `input/`, `history/`, `events/`, `ui/`, `utils/`, `styles/`.

### Smart Listener

[src/main/smart-listener.js](src/main/smart-listener.js) runs in parallel with the main recording flow. As transcription text grows, it:

1. Detects questions locally with multilingual regex patterns (PT-BR/EN/ES) — synchronous, no network.
2. Deduplicates against a 2-minute cooldown window.
3. Generates AI responses with a small concurrent pool (`MAX_CONCURRENT_RESPONSES = 2`) and queues the rest.

When Smart Listener is active, the renderer skips the final post-recording AI call (Smart Listener has already produced incremental answers per question). This is a deliberate UX decision — don't add a final-response trigger when Smart Listener is on.

### Audio capture

- **Microphone** — captured in the renderer via Web Audio APIs, PCM chunks streamed to main for local Whisper or as a Blob for cloud transcription.
- **System audio** — captured in [src/main/system-audio.js](src/main/system-audio.js). Linux uses `parec` against a PulseAudio/PipeWire monitor source; macOS/Windows use loopback via `desktopCapturer`.
- **Realtime mode** — streams audio to the provider's realtime API (`realtimeStart`/`realtimeAudio`/`realtimeStop` IPCs) for live transcription.

### Screen capture

[src/main/screen-capture.js](src/main/screen-capture.js) captures the **foreground window** (not the window under the cursor). Linux requires one of `gnome-screenshot`, `spectacle`, `scrot`, or ImageMagick's `import`.

### Click-through mode

Global shortcut (`⌥+T` / `Ctrl+Alt+T`) toggles `setIgnoreMouseEvents` on the windows. On Linux this is unconditional; on macOS/Windows it uses `{ forward: true }` so the renderer can detect modifier-key holds to temporarily re-enable interaction.

## Conventions

- Don't hardcode model names — go through [src/main/config.js](src/main/config.js) helpers.
- Don't import Electron/Node from the renderer — go through [src/preload.js](src/preload.js).
- New IPC handlers go in the matching [src/main/handlers/](src/main/handlers/) module, not in `ipc-handlers.js`.
- New config fields need both a default in `getDefaultConfig()` and (if replacing legacy fields) a migration branch in `loadConfig()`.
- UI strings that should be translated belong in [src/config/prompts.json](src/config/prompts.json) under the appropriate language key.
