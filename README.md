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

Install Node.js, Rust, and the [Tauri prerequisites for your OS](https://v2.tauri.app/start/prerequisites/). Linux builds need WebKitGTK and the listed Tauri system packages. Ollama is installed separately on each computer and must be available at `http://127.0.0.1:11434`.

```sh
npm install
npm run dev
node --test tests/*.test.mjs
```

Build packages locally on the matching OS:

```powershell
# Windows: portable executable (no setup wizard)
npm run release:exe
```

```sh
# Linux: AppImage and Debian package
npm run release:linux

# macOS: universal DMG for Apple Silicon and Intel
npm run release:macos
```

GitHub Actions builds all three platforms when code is pushed to `main` and stores the outputs as workflow artifacts. Pushing a version tag such as `v1.1.4` also creates a GitHub Release with the Windows `.exe`, Linux `.AppImage` and `.deb`, and universal macOS `.dmg`. Unsigned macOS downloads may show Gatekeeper's first-open warning; signing and notarization require the publisher's Apple Developer credentials. GPU telemetry uses `nvidia-smi` where available; the app remains usable without NVIDIA telemetry.
