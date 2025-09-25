import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('speech shell integration', () => {
  let tempDir;
  let speech;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-speech-'));
    spawnMock.mockReset();
    vi.resetModules();
    speech = await import('../src/speech.js');
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createChildProcess({ stdoutText = '', exitCode = 0 } = {}) {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();

    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;

    setImmediate(() => {
      if (stdoutText) {
        stdout.emit('data', Buffer.from(stdoutText));
      }
      child.emit('close', exitCode);
    });

    return child;
  }

  it('escapes shell arguments on POSIX systems with single quotes', () => {
    const { escapeShellArg } = speech;

    expect(escapeShellArg('hello')).toBe("'hello'");
    expect(escapeShellArg("needs 'quotes'")).toBe("'needs '\\''quotes'\\'''"
    );
    expect(escapeShellArg('')).toBe("''");
  });

  it('escapes shell arguments for Windows shells', () => {
    const { escapeShellArg } = speech;

    const windowsPath = 'C:/Users/Casey/Job Files/voice note.txt';
    expect(escapeShellArg(windowsPath, 'win32')).toBe('"C:/Users/Casey/Job Files/voice note.txt"');

    const withQuotes = 'C:/Jobs/"important"/brief.txt';
    expect(escapeShellArg(withQuotes, 'win32')).toBe('"C:/Jobs/\\"important\\"/brief.txt"');

    const trailingSlash = 'C:/Jobs/notes\\';
    expect(escapeShellArg(trailingSlash, 'win32')).toBe('"C:/Jobs/notes\\\\"');
  });

  it('substitutes escaped paths when building transcriber commands', async () => {
    const audioPath = path.join(tempDir, 'voice memo.txt');
    fs.writeFileSync(audioPath, 'Discuss roadmap');

    spawnMock.mockImplementation(() => createChildProcess({ stdoutText: 'Transcript' }));

    const result = await speech.transcribeAudio(audioPath, {
      command: 'node local/transcribe.js --file {{input}}',
    });

    expect(result).toBe('Transcript');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [command, options] = spawnMock.mock.calls[0];
    expect(command).toContain("'" + audioPath + "'");
    expect(options).toMatchObject({ shell: true });
  });

  it('injects escaped text into synthesizer commands that use {{input}}', async () => {
    spawnMock.mockImplementation(() => createChildProcess({ exitCode: 0 }));

    await speech.synthesizeSpeech('Need a win', {
      command: 'say --voice assistant {{input}}',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command] = spawnMock.mock.calls[0];
    expect(command).toContain("'Need a win'");
  });
});
