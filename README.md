# KODDAŞ

KODDAŞ is a cross-platform desktop coding assistant that runs local Ollama models on Windows, Linux, and macOS. The app uses Tauri 2, React, TypeScript, Monaco Editor, and a persistent xterm/PTY terminal.

## What it can do

- Ask, plan, and Agent modes with streamed local-model responses and VRAM-aware context sizing/recovery.
- Inspect a workspace, load applicable `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, and GitHub Copilot guidance, then add request-relevant source files as read-only context.
- Prepare coordinated multi-file patches for explicitly selected target files. It validates file paths and patch matches, retries a mismatched patch once, shows per-file diffs, makes backups, and supports undo.
- Run persistent native shell sessions in the workspace (PowerShell, Command Prompt, Git Bash, or WSL on Windows; Bash, Zsh, or sh on Linux/macOS).
- Create a Laravel project in an empty workspace, inspect Git changes, manage local Ollama models, and view GPU and system diagnostics.

Repository guidance is treated as project context. It cannot override the user's request or higher-priority instructions. File edits remain scoped to the workspace and are presented for review unless automatic approval is enabled.

## Current limits

KODDAŞ is local-first. It does not currently provide cloud agents, parallel agent teams, browser automation, or built-in web preview control. The local model and available VRAM determine how much code it can reason about at once. Multi-file edits work best when the task names the relevant files or clearly describes the feature area.

## Development and release

Install Node.js, Rust, and the [Tauri prerequisites for your OS](https://v2.tauri.app/start/prerequisites/). Linux builds require WebKitGTK and the other Tauri system packages. Install Ollama for your OS and keep it available at `http://127.0.0.1:11434`.

```powershell
npm install
npm run dev
node --test tests/*.test.mjs
```

Build the Windows standalone executable (no installer):

```powershell
npm run release:exe
```

The script runs the tests, builds the frontend and Tauri app without bundling an installer, then writes `release/KODDAŞ-<version>.exe`.

Create native packages on each operating system (Tauri desktop releases must be built on their target OS):

```sh
# Linux: AppImage and Debian package
npm run release:linux

# macOS: DMG
npm run release:macos
```

On Windows, use `npm run release:exe` for the standalone `.exe`. Artifacts are written under `src-tauri/target/release/bundle` for Linux and macOS. Ollama is installed separately on each machine; GPU telemetry is available for NVIDIA via `nvidia-smi`, while the app remains usable without GPU telemetry.
