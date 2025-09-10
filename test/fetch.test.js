import { describe, it, expect } from 'vitest';
import http from 'http';
import { extractTextFromHtml, fetchTextFromUrl } from '../src/fetch.js';

describe('extractTextFromHtml', () => {
  it('collapses whitespace and skips non-content tags', () => {
    const html = `
      <html>
        <head>
          <style>.a {}</style>
          <script>1</script>
        </head>
        <body>
          <nav>ignored</nav>
          <p>First   line</p>
          <p>Second line</p>
          <footer>ignored</footer>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('First line Second line');
  });

  it('omits aside content', () => {
    const html = `
      <html>
        <body>
          <p>Main</p>
          <aside>ignored</aside>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('Main');
  });
});

describe('fetchTextFromUrl', () => {
  it('enforces a maximum response size', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('a'.repeat(20));
    });
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    await expect(fetchTextFromUrl(url, { maxBytes: 10 })).rejects.toThrow();
    server.close();
  });
});
