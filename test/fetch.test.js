import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { fetchTextFromUrl } from '../src/fetch.js';

describe('fetchTextFromUrl', () => {
  it('rejects private network URLs', async () => {
    const server = http.createServer((req, res) => {
      res.end('ok');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await expect(
      fetchTextFromUrl(`http://127.0.0.1:${port}`)
    ).rejects.toThrow(/private URL/);
    await new Promise(resolve => server.close(resolve));
  });
});

