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

function matchLine(line, patterns) {
  for (const pattern of patterns) {
    const m = line.match(pattern);
    if (m) return m[1].trim();
  }
  return '';
}

export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  let title = '';
  let company = '';
  for (const line of lines) {
    if (!title) title = matchLine(line, TITLE_PATTERNS);
    if (!company) company = matchLine(line, COMPANY_PATTERNS);
    if (title && company) break;
  }

  // Extract requirements bullets after a known header
  let requirements = [];
  const idx = lines.findIndex(l => REQUIREMENTS_HEADERS.some(h => h.test(l)));
  if (idx !== -1) {
    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z].+:$/.test(line)) break; // next section header
      const bullet = line.replace(/^[-*•\d.)(\s]+/, '').trim();
      if (bullet) requirements.push(bullet);
    }
  }

  return { title, company, requirements, body: text };
}


