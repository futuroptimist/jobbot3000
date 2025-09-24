#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex === -1) {
  console.error('Missing --out');
  process.exit(1);
}
const outPath = path.resolve(args[outIndex + 1]);
const textIndex = args.indexOf('--text');
let text = '';
if (textIndex !== -1) {
  text = args[textIndex + 1] ?? '';
} else {
  text = fs.readFileSync(0, 'utf8');
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.appendFileSync(outPath, `${text}\n`, 'utf8');
