#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '--file' || key === '--input') {
      result.file = args[i + 1];
      i += 1;
    } else if (!result.file) {
      result.file = key;
    }
  }
  return result;
}

const { file } = parseArgs(process.argv);
if (!file) {
  console.error('Usage: transcriber.js --file <path>');
  process.exit(2);
}

const resolved = path.resolve(process.cwd(), file);
let contents;
try {
  contents = fs.readFileSync(resolved, 'utf8');
} catch (err) {
  const reason = err && typeof err.message === 'string' ? `: ${err.message}` : '';
  console.error(`transcriber: failed to read ${resolved}${reason}`);
  process.exit(1);
}

const text = contents.trim();
if (!text) {
  console.error('transcriber: audio file was empty');
  process.exit(1);
}

process.stdout.write(`Transcribed: ${text}\n`);
