# Platform support

jobbot3000 is tested on Linux, macOS, Windows Subsystem for Linux (WSL), and
Windows 11 PowerShell. The CLI and supporting scripts are written in Node.js 20
and rely on the built-in tooling available on those platforms.

## Prerequisites

| Platform | Requirements |
| --- | --- |
| Linux / WSL | Node.js 20+, Git, Python 3 (for optional tooling), and a POSIX shell |
| macOS | Node.js 20+ (via Homebrew, nvm, or the official installer) and Git |
| Windows 11 (PowerShell) | Node.js 20+ for Windows, Git for Windows, and PowerShell 7+ |

> [!NOTE]
> npm is the supported package manager. Run `npm ci` after cloning to install
> dependencies with a clean lockfile.

## Environment variables

Many CLI commands persist state under `JOBBOT_DATA_DIR`. Use the syntax that
matches your shell to set and later clear the directory:

- **Linux/macOS/WSL:** `export JOBBOT_DATA_DIR=$(mktemp -d)`
- **Windows PowerShell:**
  ```powershell
  $jobbotData = Join-Path $env:TEMP ([guid]::NewGuid())
  New-Item -ItemType Directory -Path $jobbotData | Out-Null
  $env:JOBBOT_DATA_DIR = $jobbotData
  ```

Unset the variable with `unset JOBBOT_DATA_DIR` (POSIX shells) or
`Remove-Item Env:JOBBOT_DATA_DIR` (PowerShell) once you finish testing. The CLI
uses `path.resolve('data')` when the variable is not provided, so existing users
retain their data directories.

## Speech command integration

`speech.js` launches user-provided transcription and synthesis commands via
`child_process.spawn` with `shell: true`. The helper automatically escapes
arguments with POSIX-compatible single quotes on Linux/macOS/WSL and with CMD
compatible double quotes on Windows. This means the following commands are
valid across all supported platforms:

```bash
# Linux/macOS/WSL
export JOBBOT_SPEECH_TRANSCRIBER="node local/transcribe.js --file {{input}}"
export JOBBOT_SPEECH_SYNTHESIZER="node local/say.js --text {{input}}"
```

```powershell
# Windows PowerShell
$env:JOBBOT_SPEECH_TRANSCRIBER = "node local/transcribe.js --file {{input}}"
$env:JOBBOT_SPEECH_SYNTHESIZER = "node local/say.js --text {{input}}"
```

Avoid adding your own quoting around `{{input}}`; the CLI injects a
platform-appropriate escaped value automatically.

## Postinstall behavior

`scripts/install-console-font.js` ensures a fallback console font is present on
Linux. The script quietly no-ops on macOS, WSL, and Windows when the target
folder is unavailable, so cross-platform installs do not fail.

## Required checks

All platforms run the same automated checks. Before committing changes, run:

```bash
npm run lint
npm run test:ci
```

These commands match the CI configuration documented under `.github/workflows/`.

## Troubleshooting

- **Node version mismatch:** Verify `node --version` prints 20.x or newer.
- **PowerShell quoting issues:** Remove manual quotes around `{{input}}`; the CLI
  now escapes values for Windows shells.
- **Temporary directory cleanup:** Remember to delete `$JOBBOT_DATA_DIR` when
  using ephemeral directories during exploratory runs.
