import { describe, it, expect } from 'vitest';
import { extractTextFromHtml } from '../src/fetch.js';

describe('extractTextFromHtml', () => {
  it('collapses whitespace and skips non-content tags', () => {
    const html = `
      <html>
        <head>
          <style>.a {}</style>
          <script>1</script>
        </head>
        <body>
          <header>ignored</header>
          <nav>ignored</nav>
          <p>First   line</p>
          <p>Second line</p>
          <footer>ignored</footer>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('First line Second line');
  });
});
