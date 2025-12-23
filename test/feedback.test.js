import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  recordFeedback,
  listFeedback,
  setFeedbackDataDir,
} from '../src/feedback.js';

describe('feedback collection', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-feedback-'));
    setFeedbackDataDir(dataDir);
  });

  afterEach(async () => {
    setFeedbackDataDir(undefined);
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('records sanitized feedback with optional metadata', async () => {
    const entry = await recordFeedback({
      message: '  Love the beta experience!  ',
      source: 'survey ',
      contact: ' casey@example.com ',
      rating: '5',
    });

    expect(entry).toMatchObject({
      message: 'Love the beta experience!',
      source: 'survey',
      contact: 'casey@example.com',
      rating: 5,
      id: expect.any(String),
      recorded_at: expect.stringMatching(/^\d{4}-/),
    });

    const entries = await listFeedback();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message: 'Love the beta experience!',
      source: 'survey',
      contact: 'casey@example.com',
      rating: 5,
    });
  });

  it('rejects empty feedback submissions', async () => {
    await expect(recordFeedback({ message: '   ' })).rejects.toThrow('message is required');
  });

  it('rejects out-of-range ratings and preserves existing entries', async () => {
    await recordFeedback({ message: 'First entry' });
    await expect(recordFeedback({ message: 'Second', rating: 7 })).rejects.toThrow(
      'rating must be between 1 and 5',
    );

    const entries = await listFeedback();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('First entry');
  });

  it('strips control characters and collapses whitespace before persisting', async () => {
    const entry = await recordFeedback({
      message: 'Great\u0007\nwork!  Keep it up\t',
      source: ' survey\r\n',
      contact: '\tcasey@example.com\u0000',
    });

    expect(entry).toMatchObject({
      message: 'Great work! Keep it up',
      source: 'survey',
      contact: 'casey@example.com',
    });

    const entries = await listFeedback();
    expect(entries[0]).toMatchObject({
      message: 'Great work! Keep it up',
      source: 'survey',
      contact: 'casey@example.com',
    });
  });
});
