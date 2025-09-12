#!/usr/bin/env node
import { ensureDefaultConsoleFont } from '../src/console-font.js';

const dir = process.env.CONSOLE_FONT_DIR || '/usr/share/consolefonts';
await ensureDefaultConsoleFont(dir).catch(() => {});

