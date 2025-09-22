import fs from 'node:fs/promises';
import path from 'node:path';
import removeMarkdown from 'remove-markdown';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];
const COMMON_HEADING_TERMS = ['experience', 'education', 'skills', 'projects', 'summary'];
const TITLE_PLACEHOLDERS = [
  'Your Title Here',
  'Insert Title',
  'Title Here',
  'Position Title',
  'Role Title',
  'Your Role',
  'Job Title Here',
];
const TITLE_PLACEHOLDER_PATTERN = new RegExp(
  `\\b(?:${TITLE_PLACEHOLDERS.join('|')})\\b`,
  'gi',
);
const DATE_PLACEHOLDER_PATTERNS = [
  /\b(?:19|20)[X?]{2}\b/gi,
  /\b(?:XX|\?\?)\/\d{2,4}\b/gi,
  /\b\d{1,2}\/(?:XX|\?\?)\b/gi,
  /\bTBD\b/gi,
];
const METRIC_PLACEHOLDER_PATTERNS = [
  /\b(?:XX|\?\?)\s*(?:%|percent|percentage)(?!\w)/gi,
  /\b(?:XX|\?\?)\s*(?:k|m|mm|bn|billion|million)(?!\w)/gi,
];

function createLineStartIndex(text) {
  const starts = [0];
  if (typeof text !== 'string' || text.length === 0) {
    return starts;
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }

  return starts;
}

function findLocation(lineStarts, index) {
  if (!Array.isArray(lineStarts) || lineStarts.length === 0) {
    return { line: 1, column: 1 };
  }

  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex];
  return {
    line: lineIndex + 1,
    column: index - lineStart + 1,
  };
}

function detectResumeHeadings(text) {
  if (!text) return [];
  const found = new Set();
  for (const term of COMMON_HEADING_TERMS) {
    const pattern = new RegExp(`\\b${term}\\b`, 'i');
    if (pattern.test(text)) {
      found.add(term);
    }
  }
  return Array.from(found);
}

function hasBulletFormatting(text) {
  if (!text) return false;
  return /^\s*[-*•–—]/m.test(text);
}

function estimateParsingConfidence(text, warnings = []) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return { score: 0, signals: ['No resume content detected'] };
  }

  let score = 0.35;
  const signals = [];
  const length = trimmed.length;

  if (length >= 800) {
    score += 0.3;
    signals.push('Detected substantial resume length (>= 800 characters)');
  } else if (length >= 400) {
    score += 0.25;
    signals.push('Detected sufficient resume length (>= 400 characters)');
  } else if (length >= 200) {
    score += 0.2;
    signals.push('Resume content is brief but present (< 400 characters)');
  } else {
    score -= 0.1;
    signals.push('Resume content is very short (< 200 characters)');
  }

  const headings = detectResumeHeadings(trimmed);
  if (headings.length >= 2) {
    score += 0.2;
    signals.push(`Detected common resume headings: ${headings.join(', ')}`);
  } else if (headings.length === 1) {
    score += 0.1;
    signals.push(`Detected resume heading: ${headings[0]}`);
  } else {
    score -= 0.1;
    signals.push('No common resume headings detected');
  }

  if (hasBulletFormatting(trimmed)) {
    score += 0.15;
    signals.push('Detected bullet formatting in experience sections');
  } else {
    score -= 0.05;
    signals.push('No bullet formatting detected');
  }

  if (Array.isArray(warnings)) {
    if (warnings.some(warning => warning && warning.type === 'tables')) {
      score -= 0.1;
      signals.push('Table formatting may affect ATS parsing');
    }
    if (warnings.some(warning => warning && warning.type === 'images')) {
      score -= 0.05;
      signals.push('Embedded images may be ignored by ATS scanners');
    }
  }

  const bounded = Math.max(0, Math.min(1, score));
  return { score: Number(bounded.toFixed(2)), signals };
}

function collectMatches(patterns, text, type, message) {
  if (typeof text !== 'string' || !Array.isArray(patterns) || patterns.length === 0) {
    return [];
  }

  const matches = [];
  for (const pattern of patterns) {
    const regExp = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regExp.exec(text)) !== null) {
      const [value] = match;
      if (!value) {
        regExp.lastIndex += 1;
        continue;
      }
      matches.push({ type, value, index: match.index, message });
    }
  }
  return matches;
}

function detectResumeAmbiguities(text) {
  if (!text) return [];

  const lineStarts = createLineStartIndex(text);
  const findings = [
    ...collectMatches(
      DATE_PLACEHOLDER_PATTERNS,
      text,
      'date',
      'Potential placeholder date detected',
    ),
    ...collectMatches(
      [TITLE_PLACEHOLDER_PATTERN],
      text,
      'title',
      'Potential placeholder title detected',
    ),
    ...collectMatches(
      METRIC_PLACEHOLDER_PATTERNS,
      text,
      'metric',
      'Potential placeholder metric detected',
    ).filter(match => !/^\+?$/.test(match.value.trim())),
  ];

  findings.sort((a, b) => a.index - b.index);

  const seen = new Set();
  const ambiguities = [];

  for (const finding of findings) {
    const value = finding.value.trim();
    if (!value) continue;

    const key = `${finding.type}:${finding.index}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const location = findLocation(lineStarts, finding.index);
    ambiguities.push({
      type: finding.type,
      value,
      message: finding.message,
      location,
    });
  }

  return ambiguities;
}

function detectFormat(extension) {
  if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown';
  if (extension === '.pdf') return 'pdf';
  return 'text';
}

function countWords(text) {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function containsMarkdownTable(raw) {
  if (typeof raw !== 'string' || raw.indexOf('|') === -1) return false;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    if (!line.includes('|') || !next.includes('|')) continue;
    const cellCount = line.split('|').filter(part => part.trim() !== '').length;
    if (cellCount < 2) continue;
    if (/\|?\s*:?-{3,}:?\s*(?:\||$)/.test(next)) {
      return true;
    }
    const nextCellCount = next.split('|').filter(part => part.trim() !== '').length;
    if (nextCellCount >= 2 && /\s{2,}/.test(line) === false && /\s{2,}/.test(next) === false) {
      return true;
    }
  }
  return false;
}

function containsPipeTable(raw) {
  if (typeof raw !== 'string' || raw.indexOf('|') === -1) return false;
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = trimmed.split('|').filter(Boolean);
    if (cells.length >= 3) {
      return true;
    }
  }
  return false;
}

function containsHtmlTable(raw) {
  if (typeof raw !== 'string') return false;
  return /<\s*table\b/i.test(raw);
}

function containsMarkdownImage(raw) {
  if (typeof raw !== 'string') return false;
  return /!\[[^\]]*\]\([^)]+\)/.test(raw);
}

function containsHtmlImage(raw) {
  if (typeof raw !== 'string') return false;
  return /<\s*img\b/i.test(raw);
}

function detectAtsWarnings(raw, format) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const warnings = [];

  let tablesDetected = containsHtmlTable(raw);
  if (!tablesDetected) {
    if (format === 'markdown') tablesDetected = containsMarkdownTable(raw);
    else tablesDetected = containsPipeTable(raw);
  }

  if (tablesDetected) {
    warnings.push({
      type: 'tables',
      message: 'Detected table formatting; ATS parsers often ignore table content.',
    });
  }

  let imagesDetected = containsHtmlImage(raw);
  if (!imagesDetected && format === 'markdown') {
    imagesDetected = containsMarkdownImage(raw);
  }

  if (imagesDetected) {
    warnings.push({
      type: 'images',
      message: 'Detected embedded images; ATS scanners may drop graphics entirely.',
    });
  }

  return warnings;
}

async function readRawContent(filePath, format) {
  if (format === 'pdf') {
    const buffer = await fs.readFile(filePath);
    const { default: pdf } = await import('pdf-parse');
    const data = await pdf(buffer);
    return typeof data.text === 'string' ? data.text : '';
  }
  return fs.readFile(filePath, 'utf-8');
}

function toPlainText(raw, format) {
  if (typeof raw !== 'string') return '';
  const content = format === 'markdown' ? removeMarkdown(raw) : raw;
  return content.trim();
}

/**
 * Load a resume file and return its plain text content.
 * Supports `.pdf`, `.md`, `.markdown`, and `.mdx` formats; other files are read as plain text.
 *
 * @param {string} filePath
 * @param {{ withMetadata?: boolean }} [options]
 * @returns {Promise<string | { text: string, metadata: {
 *   extension: string,
 *   format: 'pdf' | 'markdown' | 'text',
 *   bytes: number,
 *   characters: number,
 *   lineCount: number,
 *   wordCount: number,
 *   warnings?: Array<{ type: string, message: string }>,
 * } }>}
 */
export async function loadResume(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const format = detectFormat(extension);
  const raw = await readRawContent(filePath, format);
  const text = toPlainText(raw, format);

  if (!options.withMetadata) {
    return text;
  }

  const stats = await fs.stat(filePath);
  const metadata = {
    extension: extension || '',
    format,
    bytes: stats.size,
    characters: text.length,
    lineCount: countLines(text),
    wordCount: countWords(text),
  };

  const warnings = detectAtsWarnings(raw, format);
  if (warnings.length > 0) {
    metadata.warnings = warnings;
  }

  const confidence = estimateParsingConfidence(text, warnings);
  if (confidence) {
    metadata.confidence = confidence;
  }

  const ambiguities = detectResumeAmbiguities(text);
  if (ambiguities.length > 0) {
    metadata.ambiguities = ambiguities;
  }

  return { text, metadata };
}


