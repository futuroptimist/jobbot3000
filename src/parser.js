// Parse job text extracting title, company, and requirements.
// Scans lines once using precompiled regexes for performance.

const TITLE_RE = /(?:\bTitle\s*:\s*(.+))|(?:\bJob Title\s*:\s*(.+))|(?:\bPosition\s*:\s*(.+))/i;
const COMPANY_RE = /(?:\bCompany\s*:\s*(.+))|(?:\bEmployer\s*:\s*(.+))/i;
const REQUIREMENTS_RE =
  /(?:\bRequirements\b)|(?:\bQualifications\b)|(?:\bWhat you(?:'|’)ll need\b)/i;
const FALLBACK_REQ_RE = /\bResponsibilities\b/i;

export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  let title = '';
  let company = '';
  let reqIdx = -1;
  let fallbackIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!title) {
      const m = line.match(TITLE_RE);
      if (m) title = (m[1] || m[2] || m[3] || '').trim();
    }
    if (!company) {
      const m = line.match(COMPANY_RE);
      if (m) company = (m[1] || m[2] || '').trim();
    }
    if (reqIdx === -1 && REQUIREMENTS_RE.test(line)) reqIdx = i;
    else if (fallbackIdx === -1 && FALLBACK_REQ_RE.test(line)) fallbackIdx = i;
  }

  const requirements = [];
  const idx = reqIdx !== -1 ? reqIdx : fallbackIdx;
  if (idx !== -1) {
    const headerLine = lines[idx];
    let rest = headerLine
      .replace(REQUIREMENTS_RE, '')
      .replace(FALLBACK_REQ_RE, '')
      .replace(/^[:\s]+/, '');
    if (rest) {
      const first = rest.replace(/^[-*•\u2013\u2014\d.)(\s]+/, '').trim();
      if (first) requirements.push(first);
    }
    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z].+:$/.test(line)) break;
      const bullet = line.replace(/^[-+*•\u2013\u2014\d.)(\s]+/, '').trim();
      if (bullet) requirements.push(bullet);
    }
  }

  return { title, company, requirements, body: text };
}
