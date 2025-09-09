import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

export function extractTextFromHtml(html) {
  if (!html) return '';
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' }
    ]
  }).trim();
}

export async function fetchTextFromUrl(url, { timeoutMs = 10000 } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported');
  }
  const host = parsed.hostname;
  const isPrivate =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    (host.startsWith('172.') && (() => {
      const n = Number(host.split('.')[1]);
      return n >= 16 && n <= 31;
    })());
  if (isPrivate) {
    throw new Error(`Refusing to fetch private URL: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (contentType.includes('text/html')) {
    return extractTextFromHtml(body);
  }
  return body.trim();
}


