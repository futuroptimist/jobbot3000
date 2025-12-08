import path from 'node:path';

import { loadResume } from '../resume.js';

const SECTION_PATTERNS = [
  { key: 'summary', patterns: [/^summary$/i, /^professional summary$/i] },
  {
    key: 'experience',
    patterns: [/^experience$/i, /^work experience$/i, /^professional experience$/i],
  },
  {
    key: 'skills',
    patterns: [/^skills$/i, /^technical skills$/i, /^core competencies$/i],
  },
  { key: 'education', patterns: [/^education$/i, /^education & certifications$/i] },
  { key: 'projects', patterns: [/^projects$/i, /^selected projects$/i] },
  { key: 'certifications', patterns: [/^certifications$/i, /^licenses$/i] },
  { key: 'volunteer', patterns: [/^volunteer$/i, /^volunteer experience$/i] },
];

function normalizeHeading(line) {
  if (!line) return '';
  const stripped = line
    .replace(/^#+\s*/, '')
    .replace(/\s*[-:]+\s*$/, '')
    .trim();
  return stripped;
}

function detectSectionKey(line) {
  const normalized = normalizeHeading(line);
  if (!normalized) return null;
  for (const { key, patterns } of SECTION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        if (pattern.lastIndex !== 0) pattern.lastIndex = 0;
        return key;
      }
    }
  }
  return null;
}

function splitLines(text) {
  if (!text) return [];
  return String(text)
    .replace(/\r/g, '')
    .split('\n');
}

function countWords(lines) {
  let total = 0;
  for (const line of lines) {
    if (!line) continue;
    total += line
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean).length;
  }
  return total;
}

function buildSectionSummary(trimmedLines) {
  const sections = {};
  const order = [];

  let current = 'body';
  sections[current] = [];
  order.push(current);

  for (const line of trimmedLines) {
    if (!line) continue;
    const detected = detectSectionKey(line);
    if (detected) {
      current = detected;
      if (!sections[current]) {
        sections[current] = [];
        order.push(current);
      }
      continue;
    }
    sections[current].push(line);
  }

  for (const key of Object.keys(sections)) {
    if (!sections[key] || sections[key].length === 0) {
      delete sections[key];
    }
  }

  const sectionOrder = order.filter(
    (key, index) => order.indexOf(key) === index && sections[key],
  );
  return { sections, sectionOrder };
}

function collectPlaceholderTokens(line) {
  if (!line) return [];
  const matches = line.match(
    /(?:^|\s)(XX%?|YY%?|\?\?%?|TBD|N\/A|FILL ME IN)(?=\s|$|[.,;:!?])/gi,
  );
  if (!matches) return [];
  return matches.map(token => token.trim().toUpperCase());
}

function analyzeSection(name, lines) {
  const placeholderTokens = new Set();
  let totalWords = 0;
  let hasMetrics = false;

  for (const line of lines) {
    if (!line) continue;
    totalWords += countWords([line]);
    if (/\d/.test(line)) {
      hasMetrics = true;
    }
    for (const token of collectPlaceholderTokens(line)) {
      placeholderTokens.add(token);
    }
  }

  const lineCount = lines.length;
  const averageWordsPerLine =
    lineCount === 0 ? 0 : Number((totalWords / lineCount).toFixed(2));

  return {
    lineCount,
    averageWordsPerLine,
    hasMetrics,
    placeholderTokens: Array.from(placeholderTokens),
    hasPlaceholders: placeholderTokens.size > 0,
    section: name,
  };
}

function summarizeEnrichment(sections) {
  const insights = {};
  const sectionsWithMetrics = [];
  const placeholderSections = [];
  const REQUIRED_SECTIONS = ['experience', 'projects', 'education', 'skills'];

  for (const [name, lines] of Object.entries(sections)) {
    const details = analyzeSection(name, lines);
    insights[name] = details;
    if (details.hasMetrics) {
      sectionsWithMetrics.push(name);
    }
    if (details.hasPlaceholders) {
      placeholderSections.push(name);
    }
  }

  const missingSections = REQUIRED_SECTIONS.filter(section => !sections[section]);

  return {
    sections: insights,
    sectionsWithMetrics,
    placeholderSections,
    missingSections,
  };
}

/**
 * Stage-driven helper that runs the resume ingestion pipeline against a single source file.
 * Each stage mutates the shared context with typed outputs so downstream consumers can
 * inspect intermediate results (plain-text resume, metadata, warning heuristics) or insert
 * new stages without rewriting the orchestration logic. The default implementation wires the
 * existing `loadResume` helper into a reusable pipeline surface.
 */

function cloneEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => ({ ...entry }));
}

const RESUME_PIPELINE_STAGES = [
  {
    name: 'load',
    run: async (context, options = {}) => {
      const withMetadata = options.withMetadata !== false;
      const result = await loadResume(context.filePath, { withMetadata });
      if (typeof result === 'string') {
        context.text = result;
        context.metadata = undefined;
        return { text: result, metadata: undefined };
      }
      const { text, metadata } = result;
      context.text = text;
      context.metadata = metadata;
      return { text, metadata };
    },
  },
  {
    name: 'normalize',
    run: context => {
      const lines = splitLines(context.text || '');
      const trimmedLines = lines.map(line => line.trim());
      const nonEmptyLines = trimmedLines.filter(Boolean);
      const { sections, sectionOrder } = buildSectionSummary(trimmedLines);
      const output = {
        lineCount: lines.length,
        nonEmptyLineCount: nonEmptyLines.length,
        wordCount: countWords(nonEmptyLines),
        sections,
        sectionOrder,
        lines: trimmedLines,
      };
      context.normalizedResume = output;
      return output;
    },
  },
  {
    name: 'enrich',
    run: context => {
      const normalized = context.normalizedResume || { sections: {} };
      const enrichment = summarizeEnrichment(normalized.sections || {});
      context.enrichment = enrichment;
      return enrichment;
    },
  },
  {
    name: 'analyze',
    run: context => {
      const metadata = context.metadata || {};
      const warnings = cloneEntries(metadata.warnings);
      const ambiguities = cloneEntries(metadata.ambiguities);
      const confidence = metadata.confidence
        ? { ...metadata.confidence }
        : { score: undefined, signals: [] };

      const analysis = {
        warnings,
        ambiguities,
        warningCount: warnings.length,
        ambiguityCount: ambiguities.length,
        confidence,
      };

      context.analysis = analysis;
      return analysis;
    },
  },
  {
    name: 'score',
    run: context => {
      const enrichment = context.enrichment || {
        sectionsWithMetrics: [],
        placeholderSections: [],
        missingSections: [],
        sections: {},
      };
      const analysis = context.analysis || {
        warningCount: 0,
        ambiguityCount: 0,
        confidence: { score: undefined },
      };
      const normalized = context.normalizedResume || { sections: {}, lineCount: 0 };

      const totalSections = Object.keys(enrichment.sections || {}).length;
      const sectionsWithMetrics = enrichment.sectionsWithMetrics || [];
      const placeholderSections = enrichment.placeholderSections || [];
      const missingSections = enrichment.missingSections || [];

      const score = {
        totalSections,
        metricsCoverageRatio:
          totalSections === 0 ? 0 : Number((sectionsWithMetrics.length / totalSections).toFixed(2)),
        placeholderRatio:
          totalSections === 0
            ? 0
            : Number((placeholderSections.length / totalSections).toFixed(2)),
        missingSections,
        warningCount: analysis.warningCount ?? 0,
        ambiguityCount: analysis.ambiguityCount ?? 0,
        confidenceScore: analysis.confidence?.score,
        totalLines: normalized.lineCount || 0,
      };

      context.score = score;
      return score;
    },
  },
];

export async function runResumePipeline(filePath, options = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('resume path is required');
  }

  const resolved = path.resolve(filePath);
  const context = {
    filePath: resolved,
    source: { path: resolved },
    stages: [],
  };

  for (const stage of RESUME_PIPELINE_STAGES) {
    const output = await stage.run(context, options);
    context.stages.push({ name: stage.name, output });
  }

  return {
    source: context.source,
    text: context.text,
    metadata: context.metadata,
    normalized: context.normalizedResume,
    enrichment: context.enrichment,
    analysis: context.analysis,
    score: context.score,
    stages: context.stages.map(stage => ({ name: stage.name, output: stage.output })),
  };
}

export { RESUME_PIPELINE_STAGES };
