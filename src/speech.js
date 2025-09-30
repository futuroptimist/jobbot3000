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

const WHITESPACE_CHARS = new Set([' ', '\n', '\r', '\t']);

function isWhitespace(char) {
  return WHITESPACE_CHARS.has(char);
}

function parseCommandTemplate(template) {
  const trimmed = template.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(part => typeof part === 'string')) {
        return parsed;
      }
    } catch {
      // Fall through to string parsing when JSON parsing fails.
    }
  }

  const tokens = [];
  let current = '';
  let mode = null; // null, 'single', 'double'

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];

    if (mode === 'single') {
      if (char === "'") {
        mode = null;
        continue;
      }
      current += char;
      continue;
    }

    if (mode === 'double') {
      if (char === '"') {
        mode = null;
        continue;
      }
      if (char === '\\') {
        const next = trimmed[i + 1];
        if (next === '"' || next === '\\') {
          current += next;
          i += 1;
          continue;
        }
        current += '\\';
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'") {
      mode = 'single';
      continue;
    }
    if (char === '"') {
      mode = 'double';
      continue;
    }
    if (isWhitespace(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (char === '\\') {
      const next = trimmed[i + 1];
      if (next === undefined) {
        current += '\\';
        continue;
      }
      if (next === '"' || next === '\\') {
        current += next;
        i += 1;
        continue;
      }
      if (isWhitespace(next)) {
        current += next;
        i += 1;
        continue;
      }
      current += '\\';
      continue;
    }

    current += char;
  }

  if (mode === 'single' || mode === 'double') {
    throw new Error('speech command has unmatched quotes');
  }

  if (current) tokens.push(current);
  return tokens;
}

function injectPlaceholder(tokens, value) {
  let replaced = false;
  const result = tokens.map(token => {
    if (token.includes('{{input}}')) {
      replaced = true;
      return token.split('{{input}}').join(value);
    }
    return token;
  });
  return { replaced, tokens: result };
}

function runTranscriber(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

function runSynthesizer(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
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
  const parts = parseCommandTemplate(commandTemplate);
  if (parts.length === 0) {
    throw new Error('speech transcriber command is not configured.');
  }
  const { replaced, tokens } = injectPlaceholder(parts, resolved);
  const invocation = replaced ? tokens.slice() : [...parts, resolved];
  if (invocation.length === 0) {
    throw new Error('speech transcriber command is not configured.');
  }
  const [command, ...args] = invocation;

  return runTranscriber(command, args);
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
  const parts = parseCommandTemplate(commandTemplate);
  if (parts.length === 0) {
    throw new Error('speech synthesizer command is not configured.');
  }
  const { replaced, tokens } = injectPlaceholder(parts, trimmed);
  const invocation = tokens.slice();
  if (invocation.length === 0) {
    throw new Error('speech synthesizer command is not configured.');
  }
  const [command, ...args] = invocation;

  await runSynthesizer(command, args, { input: replaced ? undefined : trimmed });
}
