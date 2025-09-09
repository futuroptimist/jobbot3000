const TITLE_PATTERNS = [
  /\bTitle\s*:\s*(.+)/i,
  /\bJob Title\s*:\s*(.+)/i,
  /\bPosition\s*:\s*(.+)/i
];

const COMPANY_PATTERNS = [
  /\bCompany\s*:\s*(.+)/i,
  /\bEmployer\s*:\s*(.+)/i
];

const REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /\bWhat you(?:'|’)ll need\b/i
];

const FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];

function findFirstMatch(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
  }
  return '';
}

export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  const title = findFirstMatch(lines, TITLE_PATTERNS);
  const company = findFirstMatch(lines, COMPANY_PATTERNS);

  // Extract requirements bullets after a known header. Prefer primary headers, but fall back to
  // "Responsibilities" if none are present.
  let requirements = [];
  let idx = lines.findIndex(l => REQUIREMENTS_HEADERS.some(h => h.test(l)));
  if (idx === -1) {
    idx = lines.findIndex(l => FALLBACK_REQUIREMENTS_HEADERS.some(h => h.test(l)));
  }
  if (idx !== -1) {
    const headerLine = lines[idx];
    let rest = '';
    for (const h of REQUIREMENTS_HEADERS) {
      if (h.test(headerLine)) {
        rest = headerLine.replace(h, '').trim();
        break;
      }
    }
    rest = rest.replace(/^[:\s]+/, '');
    if (rest) {
      const first = rest.replace(/^[-*•\u2013\u2014\u00B7\d.)(\s]+/, '').trim();
      if (first) requirements.push(first);
    }

    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z].+:$/.test(line)) break; // next section header
      // Strip common bullet characters including hyphen, plus, asterisk, bullet,
      // middle dot (\u00B7), en dash (\u2013), em dash (\u2014), digits, punctuation and whitespace
      const bullet = line.replace(/^[-+*•\u00B7\u2013\u2014\d.)(\s]+/, '').trim();
      if (bullet) requirements.push(bullet);
    }
  }

  return { title, company, requirements, body: text };
}
