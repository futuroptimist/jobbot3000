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

function collectMatches(patterns, text) {
  const matches = [];
  for (const pattern of patterns) {
    const regExp = pattern;
    let match;
    regExp.lastIndex = 0;
    while ((match = regExp.exec(text)) !== null) {
      if (match[0]) {
        matches.push(match[0]);
      }
    }
  }
  return matches;
}

function detectAmbiguities(text) {
  if (!text) return [];
  const ambiguities = [];
  const seen = new Set();

  const addFinding = (type, value, message) => {
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    ambiguities.push({ type, value, message });
  };

  for (const match of collectMatches(DATE_PLACEHOLDER_PATTERNS, text)) {
    addFinding('date', match.trim(), 'Potential placeholder date detected');
  }

  const titleMatches = text.match(TITLE_PLACEHOLDER_PATTERN);
  if (titleMatches) {
    for (const match of titleMatches) {
      addFinding('title', match.trim(), 'Potential placeholder title detected');
    }
  }

  for (const match of collectMatches(METRIC_PLACEHOLDER_PATTERNS, text)) {
    const value = match.trim();
    if (!value || /^\+?$/.test(value)) continue;
    addFinding('metric', value, 'Potential placeholder metric detected');
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

const MONTH_PATTERN_PARTS = [
  'jan(?:uary)?',
  'feb(?:ruary)?',
  'mar(?:ch)?',
  'apr(?:il)?',
  'may',
  'jun(?:e)?',
  'jul(?:y)?',
  'aug(?:ust)?',
  'sep(?:tember)?',
  'oct(?:ober)?',
  'nov(?:ember)?',
  'dec(?:ember)?',
];
const MONTH_NAME_RE = new RegExp(`\\b(?:${MONTH_PATTERN_PARTS.join('|')})\\b`, 'i');
const YEAR_RE = /\b(19|20)\d{2}\b/;
const DIGIT_RE = /\d/;
const TITLE_KEYWORDS = [
  'engineer',
  'developer',
  'manager',
  'designer',
  'consultant',
  'analyst',
  'director',
  'specialist',
  'architect',
  'scientist',
  'lead',
];

function detectAmbiguities(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];

  const ambiguities = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!MONTH_NAME_RE.test(line)) continue;
    if (YEAR_RE.test(line)) continue;
    ambiguities.push({
      type: 'dates',
      message: 'Detected month references without four-digit years; confirm date ranges are clear.',
    });
    break;
  }

  if (!DIGIT_RE.test(raw)) {
    ambiguities.push({
      type: 'metrics',
      message: 'No numeric metrics detected; consider adding quantified achievements.',
    });
  }

  let hasTitleKeyword = false;
  for (const keyword of TITLE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(raw)) {
      hasTitleKeyword = true;
      break;
    }
  }
  if (!hasTitleKeyword) {
    ambiguities.push({
      type: 'titles',
      message: 'No common role titles detected; ensure positions are clearly labeled.',
    });
  }

  return ambiguities;
}

function computeConfidenceScore(warnings, ambiguities) {
  const warningCount = Array.isArray(warnings) ? warnings.length : 0;
  const ambiguityCount = Array.isArray(ambiguities) ? ambiguities.length : 0;
  const penalty = warningCount * 0.15 + ambiguityCount * 0.1;
  const score = Math.max(0.3, Math.min(1, 1 - penalty));
  return Math.round(score * 100) / 100;
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
  const ambiguities = detectAmbiguities(raw);
  const confidence = computeConfidenceScore(warnings, ambiguities);

  if (warnings.length > 0) {
    metadata.warnings = warnings;
  }
  if (ambiguities.length > 0) {
    metadata.ambiguities = ambiguities;
  }
  metadata.confidence = confidence;

  const confidence = estimateParsingConfidence(text, warnings);
  if (confidence) {
    metadata.confidence = confidence;
  }

  const ambiguities = detectAmbiguities(text);
  if (ambiguities.length > 0) {
    metadata.ambiguities = ambiguities;
  }

  return { text, metadata };
}


