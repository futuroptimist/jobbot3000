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

  it('spawns the transcriber without shell interpolation and preserves spaced paths', async () => {
    const audioPath = path.join(tempDir, 'voice memo.txt');
    fs.writeFileSync(audioPath, 'Discuss roadmap');

    spawnMock.mockImplementation(() => createChildProcess({ stdoutText: 'Transcript' }));

    const result = await speech.transcribeAudio(audioPath, {
      command: 'node local/transcribe.js --file {{input}}',
    });

    expect(result).toBe('Transcript');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [file, args, options] = spawnMock.mock.calls[0];
    expect(file).toBe('node');
    expect(args).toEqual(['local/transcribe.js', '--file', audioPath]);
    expect(options).toMatchObject({ stdio: ['ignore', 'pipe', 'pipe'] });
    expect(options.shell).toBeUndefined();
  });

  it('supports quoted command segments when parsing the transcriber template', async () => {
    const scriptPath = path.join('tools', 'voice', 'transcriber.js');
    const clipPath = path.join(tempDir, 'clip.wav');
    fs.writeFileSync(clipPath, 'Discuss roadmap');
    spawnMock.mockImplementation(() => createChildProcess({ stdoutText: 'Words' }));

    await speech.transcribeAudio(clipPath, {
      command: `node "${scriptPath}" --file "{{input}}"`,
    });

    const [file, args] = spawnMock.mock.calls[0];
    expect(file).toBe('node');
    expect(args[0]).toBe(scriptPath);
    expect(args[1]).toBe('--file');
    expect(args[2]).toMatch(/clip\.wav$/);
  });

  it('appends the audio path when the transcriber command omits {{input}}', async () => {
    const audioPath = path.join(tempDir, 'note.wav');
    fs.writeFileSync(audioPath, 'Discuss roadmap');

    spawnMock.mockImplementation(() => createChildProcess({ stdoutText: 'Transcript' }));

    await speech.transcribeAudio(audioPath, {
      command: 'python scripts/transcribe.py --fast',
    });

    const [file, args] = spawnMock.mock.calls[0];
    expect(file).toBe('python');
    expect(args).toEqual(['scripts/transcribe.py', '--fast', audioPath]);
  });

  it('injects text into synthesizer arguments that use {{input}}', async () => {
    spawnMock.mockImplementation(() => createChildProcess({ exitCode: 0 }));

    await speech.synthesizeSpeech('Need a win', {
      command: 'say --voice assistant {{input}}',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawnMock.mock.calls[0];
    expect(file).toBe('say');
    expect(args).toEqual(['--voice', 'assistant', 'Need a win']);
    expect(options).toMatchObject({ stdio: ['pipe', 'ignore', 'pipe'] });
  });

  it('pipes synthesizer input when the template omits {{input}}', async () => {
    let captured = '';
    spawnMock.mockImplementation(() => {
      const child = createChildProcess({ exitCode: 0 });
      child.stdin.on('data', chunk => {
        captured += chunk.toString();
      });
      return child;
    });

    await speech.synthesizeSpeech('Ship it', {
      command: 'node ./synthesizer.js --mode stream',
    });

    expect(captured).toBe('Ship it');
    const [file, args] = spawnMock.mock.calls[0];
    expect(file).toBe('node');
    expect(args).toEqual(['./synthesizer.js', '--mode', 'stream']);
  });
});
