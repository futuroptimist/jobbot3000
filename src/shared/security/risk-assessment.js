const STRIDE_CATEGORIES = new Map([
  ['spoofing', 'Spoofing'],
  ['tampering', 'Tampering'],
  ['repudiation', 'Repudiation'],
  ['information disclosure', 'Information Disclosure'],
  ['denial of service', 'Denial of Service'],
  ['elevation of privilege', 'Elevation of Privilege'],
]);

const RATING_SCALE = new Map([
  ['low', { label: 'low', weight: 1 }],
  ['medium', { label: 'medium', weight: 2 }],
  ['high', { label: 'high', weight: 3 }],
  ['critical', { label: 'critical', weight: 4 }],
]);

const SEVERITY_THRESHOLDS = [
  { min: 16, level: 'critical', action: 'Block launch until mitigations lower risk.' },
  {
    min: 9,
    level: 'high',
    action: 'Security sign-off required before launch; document mitigations and detection.',
  },
  {
    min: 4,
    level: 'medium',
    action: 'Document mitigations and detection before launch; monitor post-release.',
  },
  { min: 0, level: 'low', action: 'Document residual risk and monitor.' },
];

function normalizeString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function sanitizeStringArray(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new Error(`${fieldName} must be an array`);
  }
  const sanitized = Array.from(
    new Set(
      values.map(item => {
        if (typeof item !== 'string') {
          throw new Error(`${fieldName} entries must be strings`);
        }
        return item.trim();
      }),
    ),
  ).filter(Boolean);
  if (sanitized.length === 0) {
    throw new Error(`${fieldName} must contain at least one entry`);
  }
  return sanitized;
}

function resolveRating(value, fieldName) {
  const key = normalizeString(value, fieldName).toLowerCase();
  const rating = RATING_SCALE.get(key);
  if (!rating) {
    const allowed = Array.from(RATING_SCALE.keys()).join(', ');
    throw new Error(`${fieldName} must be one of: ${allowed}`);
  }
  return rating;
}

function resolveStrideCategory(value, fieldName) {
  const key = normalizeString(value, fieldName).toLowerCase();
  const category = STRIDE_CATEGORIES.get(key);
  if (!category) {
    const allowed = Array.from(STRIDE_CATEGORIES.values()).join(', ');
    throw new Error(`${fieldName} must be a STRIDE category: ${allowed}`);
  }
  return category;
}

function computeSeverityScore(impact, likelihood) {
  const score = impact.weight * likelihood.weight;
  for (const threshold of SEVERITY_THRESHOLDS) {
    if (score >= threshold.min) {
      return { score, level: threshold.level, action: threshold.action };
    }
  }
  return { score, level: 'low', action: 'Document residual risk and monitor.' };
}

function titleCase(value) {
  if (!value) return '';
  return value
    .split(' ')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function escapeTable(value) {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * @typedef {Object} RiskScenarioInput
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {string} description
 * @property {string} impact
 * @property {string} likelihood
 * @property {string[]} [mitigations]
 * @property {string[]} [detection]
 * @property {string[]} [notes]
 */

/**
 * @typedef {Object} RiskAssessmentOptions
 * @property {string} feature
 * @property {string} [summary]
 * @property {string} [dataClassification]
 * @property {string[]} assets
 * @property {string[]} entryPoints
 * @property {string[]} threatActors
 * @property {RiskScenarioInput[]} scenarios
 * @property {{
 *   mustHave?: string[],
 *   defenseInDepth?: string[],
 *   detection?: string[],
 * }} [mitigations]
 * @property {string} [residualRisk]
 * @property {string[]} [references]
 */

/**
 * @typedef {ReturnType<typeof createRiskAssessment>['scenarios'][number]} RiskScenario
 */

/**
 * @param {RiskAssessmentOptions} options
 */
export function createRiskAssessment(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('risk assessment options are required');
  }
  const feature = normalizeString(options.feature, 'feature name');
  const summary = options.summary ? normalizeString(options.summary, 'summary') : '';
  const dataClassification = options.dataClassification
    ? normalizeString(options.dataClassification, 'data classification')
    : 'Unclassified';

  const assets = sanitizeStringArray(options.assets, 'assets');
  const entryPoints = sanitizeStringArray(options.entryPoints, 'entry points');
  const threatActors = sanitizeStringArray(options.threatActors, 'threat actors');

  if (!Array.isArray(options.scenarios) || options.scenarios.length === 0) {
    throw new Error('scenarios must contain at least one entry');
  }

  const strideCoverage = new Set();

  const scenarios = options.scenarios.map(raw => {
    const id = normalizeString(raw.id, 'scenario id');
    const title = normalizeString(raw.title, 'scenario title');
    const category = resolveStrideCategory(raw.category, 'scenario category');
    strideCoverage.add(category);
    const description = normalizeString(raw.description, 'scenario description');
    const impact = resolveRating(raw.impact, 'scenario impact');
    const likelihood = resolveRating(raw.likelihood, 'scenario likelihood');
    const severity = computeSeverityScore(impact, likelihood);
    const mitigations = raw.mitigations
      ? sanitizeStringArray(raw.mitigations, 'scenario mitigations')
      : [];
    const detection = raw.detection
      ? sanitizeStringArray(raw.detection, 'scenario detection steps')
      : [];
    const notes = raw.notes ? sanitizeStringArray(raw.notes, 'scenario notes') : [];

    return {
      id,
      title,
      category,
      description,
      impact: impact.label,
      likelihood: likelihood.label,
      severity,
      mitigations,
      detection,
      notes,
    };
  });

  scenarios.sort((a, b) => b.severity.score - a.severity.score);
  const highest = scenarios[0];

  const summaryAction = highest.severity.action;

  const mitigations = {
    mustHave: options.mitigations?.mustHave
      ? sanitizeStringArray(options.mitigations.mustHave, 'mitigations.mustHave')
      : [],
    defenseInDepth: options.mitigations?.defenseInDepth
      ? sanitizeStringArray(options.mitigations.defenseInDepth, 'mitigations.defenseInDepth')
      : [],
    detection: options.mitigations?.detection
      ? sanitizeStringArray(options.mitigations.detection, 'mitigations.detection')
      : [],
  };

  const references = options.references
    ? sanitizeStringArray(options.references, 'references')
    : [];

  return {
    feature,
    summary: {
      description: summary,
      dataClassification,
      highestSeverity: highest.severity.level,
      highestScore: highest.severity.score,
      recommendedAction: summaryAction,
      requiresSecurityReview:
        highest.severity.level === 'high' || highest.severity.level === 'critical',
      requiresExecutiveReview: highest.severity.level === 'critical',
      strideCoverage: Array.from(strideCoverage).sort(),
      scenarioCount: scenarios.length,
    },
    threatModel: {
      assets,
      entryPoints,
      threatActors,
    },
    scenarios,
    mitigations,
    residualRisk: options.residualRisk
      ? normalizeString(options.residualRisk, 'residual risk')
      : '',
    references,
  };
}

/**
 * @param {{
 *   feature: string,
 *   summary: {
 *     description: string,
 *     dataClassification: string,
 *     highestSeverity: string,
 *     highestScore: number,
 *     recommendedAction: string,
 *     strideCoverage: string[],
 *   },
 *   threatModel: { assets: string[], entryPoints: string[], threatActors: string[] },
 *   scenarios: RiskScenario[],
 *   mitigations: { mustHave: string[], defenseInDepth: string[], detection: string[] },
 *   residualRisk: string,
 *   references: string[],
 * }} assessment
 */
export function formatRiskAssessmentMarkdown(assessment) {
  const lines = [];
  lines.push(`# Risk assessment: ${assessment.feature}`);
  lines.push('');
  if (assessment.summary.description) {
    lines.push(`**Summary:** ${assessment.summary.description}`);
    lines.push('');
  }
  lines.push(`**Data classification:** ${assessment.summary.dataClassification}`);
  lines.push(
    `**Highest severity:** ${titleCase(assessment.summary.highestSeverity)} ` +
      `(score ${assessment.summary.highestScore})`,
  );
  lines.push(`**Recommended action:** ${assessment.summary.recommendedAction}`);
  if (assessment.summary.strideCoverage.length > 0) {
    lines.push(
      `**STRIDE coverage:** ${assessment.summary.strideCoverage.join(', ')}`,
    );
  }
  lines.push('');
  lines.push('## Threat model overview');
  lines.push('');

  const appendSection = (title, items) => {
    if (!items || items.length === 0) return;
    lines.push(`### ${title}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  };

  appendSection('Assets', assessment.threatModel.assets);
  appendSection('Entry points', assessment.threatModel.entryPoints);
  appendSection('Threat actors', assessment.threatModel.threatActors);

  lines.push('## Scenario analysis');
  lines.push('');
  lines.push(
    '| ID | Scenario | STRIDE | Impact | Likelihood | Score | Severity | Recommended action |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const scenario of assessment.scenarios) {
    const severity = titleCase(scenario.severity.level);
    lines.push(
      `| ${escapeTable(scenario.id)} | ${escapeTable(scenario.title)} | ${escapeTable(
        scenario.category,
      )} | ${titleCase(scenario.impact)} | ${titleCase(scenario.likelihood)} | ${
        scenario.severity.score
      } | ${severity} | ${escapeTable(scenario.severity.action)} |`,
    );
  }
  lines.push('');

  const appendListSection = (title, items) => {
    if (!items || items.length === 0) return;
    lines.push(`### ${title}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  };

  appendListSection('Mitigations (must implement)', assessment.mitigations.mustHave);
  appendListSection('Mitigations (defense in depth)', assessment.mitigations.defenseInDepth);
  appendListSection('Detection & response', assessment.mitigations.detection);

  if (assessment.residualRisk) {
    lines.push('### Residual risk');
    lines.push('');
    lines.push(assessment.residualRisk);
    lines.push('');
  }

  if (assessment.references.length > 0) {
    lines.push('### References');
    lines.push('');
    for (const reference of assessment.references) {
      lines.push(`- ${reference}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
