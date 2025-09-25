import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

let overrideTranscriberCommand;
let overrideSynthesizerCommand;

export function setSpeechTranscriberCommand(command) {
  overrideTranscriberCommand = command || undefined;
}

export function setSpeechSynthesizerCommand(command) {
  overrideSynthesizerCommand = command || undefined;
}

function resolveTranscriberCommand(optionCommand) {
  const candidate =
    optionCommand ??
    overrideTranscriberCommand ??
    process.env.JOBBOT_SPEECH_TRANSCRIBER;
  if (typeof candidate !== 'string') {
    throw new Error('speech transcriber command is not configured.');
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error('speech transcriber command is not configured.');
  }
  return trimmed;
}

function resolveSynthesizerCommand(optionCommand) {
  const candidate =
    optionCommand ??
    overrideSynthesizerCommand ??
    process.env.JOBBOT_SPEECH_SYNTHESIZER;
  if (typeof candidate !== 'string') {
    throw new Error('speech synthesizer command is not configured.');
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error('speech synthesizer command is not configured.');
  }
  return trimmed;
}

function escapeWindowsArg(str) {
  let result = '"';
  let backslashes = 0;

  for (const char of str) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }

    if (char === '"') {
      result += '\\'.repeat(backslashes * 2 + 1);
      result += '"';
      backslashes = 0;
      continue;
    }

    result += '\\'.repeat(backslashes);
    backslashes = 0;
    result += char;
  }

  result += '\\'.repeat(backslashes * 2);
  result += '"';
  return result;
}

export function escapeShellArg(value, platform = process.platform) {
  const isWindows = platform === 'win32';
  if (value === undefined || value === null) return isWindows ? '""' : "''";
  const str = String(value);
  if (str === '') return isWindows ? '""' : "''";

  if (isWindows) {
    return escapeWindowsArg(str);
  }

  const SINGLE_QUOTE = "'";
  const ESCAPED_QUOTE = "'\\'" + "'";
  return SINGLE_QUOTE + str.split(SINGLE_QUOTE).join(ESCAPED_QUOTE) + SINGLE_QUOTE;
}

function runShellCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', err => {
      reject(new Error(`speech transcriber failed: ${err.message}`));
    });
    child.on('close', code => {
      if (code !== 0) {
        const message = stderr.trim() || `speech transcriber exited with code ${code}`;
        reject(new Error(message));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error('speech transcriber produced no output'));
        return;
      }
      resolve(text);
    });
  });
}

function runSpeechCommand(command, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';

    if (input !== undefined && input !== null) {
      child.stdin.write(String(input));
    }
    child.stdin.end();

    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', err => {
      reject(new Error(`speech synthesizer failed: ${err.message}`));
    });
    child.on('close', code => {
      if (code !== 0) {
        const message = stderr.trim() || `speech synthesizer exited with code ${code}`;
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}

export async function transcribeAudio(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('audio file path is required');
  }
  const resolved = path.resolve(filePath);
  try {
    await fs.access(resolved);
  } catch {
    throw new Error(`audio file not found: ${resolved}`);
  }

  const commandTemplate = resolveTranscriberCommand(options.command);
  const escapedPath = escapeShellArg(resolved);
  const command = commandTemplate.includes('{{input}}')
    ? commandTemplate.split('{{input}}').join(escapedPath)
    : `${commandTemplate} ${escapedPath}`;

  return runShellCommand(command);
}

export async function synthesizeSpeech(text, options = {}) {
  if (text == null) {
    throw new Error('speech text is required');
  }
  const value = String(text);
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('speech text is required');
  }

  const commandTemplate = resolveSynthesizerCommand(options.command);
  let shouldPipeInput = true;
  let command = commandTemplate;

  if (commandTemplate.includes('{{input}}')) {
    command = commandTemplate.split('{{input}}').join(escapeShellArg(trimmed));
    shouldPipeInput = false;
  }

  await runSpeechCommand(command, { input: shouldPipeInput ? trimmed : undefined });
}
