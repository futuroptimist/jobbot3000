#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'docs', 'chore-catalog.md');

function normalizeCell(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function stripInlineCode(value) {
  const trimmed = normalizeCell(value);
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseCommandsCell(cell) {
  if (!cell) return [];
  const cleaned = normalizeCell(cell).replace(/\\\|/g, '|');
  return cleaned
    .split(/<br\s*\/?\s*>/i)
    .map(stripInlineCode)
    .map(command => command.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseCatalogTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.startsWith('| Task '));
  if (headerIndex === -1) {
    throw new Error('Failed to locate chore catalog table.');
  }

  const rows = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim().startsWith('|')) break;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map(normalizeCell);
    if (cells.length < 4) continue;

    const [task, owner, frequency, commandsCell] = cells;
    rows.push({
      task,
      owner,
      frequency,
      commands: parseCommandsCell(commandsCell),
    });
  }
  if (rows.length === 0) {
    throw new Error('No chore entries found in catalog.');
  }
  return rows;
}

function formatTextReminders(tasks) {
  const lines = ['Chore reminders'];
  lines.push('================');
  for (const task of tasks) {
    lines.push('');
    lines.push(`• ${task.task}`);
    lines.push(`  Owner: ${task.owner}`);
    lines.push(`  Frequency: ${task.frequency}`);
    if (task.commands.length > 0) {
      lines.push('  Commands:');
      for (const command of task.commands) {
        lines.push(`    - ${command}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const raw = await fs.readFile(CATALOG_PATH, 'utf8');
  const tasks = parseCatalogTable(raw);

  const args = process.argv.slice(2);
  let wantsJson = args.includes('--json') || args.includes('--format=json');
  const formatIndex = args.indexOf('--format');
  if (formatIndex !== -1) {
    const next = args[formatIndex + 1];
    if (typeof next === 'string' && next.toLowerCase() === 'json') {
      wantsJson = true;
    }
  }

  if (wantsJson) {
    const payload = { tasks };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatTextReminders(tasks));
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
