import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import { DEFAULT_SETTINGS, loadSettings } from './settings.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setInterviewDataDir(dir) {
  overrideDir = dir || undefined;
}

async function safeReadDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isVisibleDirectory(entry) {
  return entry?.isDirectory?.() && !entry.name.startsWith('.');
}

function isVisibleSessionFile(entry) {
  if (!entry?.isFile?.()) return false;
  if (entry.name.startsWith('.')) return false;
  return entry.name.toLowerCase().endsWith('.json');
}

function resolveRemindersNow(now) {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new Error('now must be a valid Date');
    }
    return now;
  }
  if (typeof now === 'string') {
    const parsed = new Date(now);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('now must be a valid ISO-8601 timestamp');
    }
    return parsed;
  }
  if (now === undefined) {
    return new Date();
  }
  throw new Error('now must be a Date or ISO-8601 string');
}

function coerceReminderNumber(value, label) {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return numeric;
}

function extractReminderSuggestions(payload) {
  const tighten = payload?.heuristics?.critique?.tighten_this;
  if (!Array.isArray(tighten)) return undefined;
  const cleaned = tighten
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

async function readReminderSession(filePath) {
  let payload;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    payload = JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  let recordedAt = coerceIsoTimestamp(payload.recorded_at);
  let source = recordedAt ? 'recorded_at' : undefined;
  if (!recordedAt) {
    const startedAt = coerceIsoTimestamp(payload.started_at ?? payload.startedAt);
    if (startedAt) {
      recordedAt = startedAt;
      source = 'started_at';
    }
  }
  if (!recordedAt) {
    const endedAt = coerceIsoTimestamp(payload.ended_at ?? payload.endedAt);
    if (endedAt) {
      recordedAt = endedAt;
      source = 'ended_at';
    }
  }
  if (!recordedAt) {
    try {
      const stats = await fs.stat(filePath);
      const mtime = stats.mtime instanceof Date ? stats.mtime : undefined;
      if (mtime && !Number.isNaN(mtime.getTime())) {
        recordedAt = mtime.toISOString();
        source = 'file_mtime';
      }
    } catch {
      // Ignore fallback failures.
    }
  }

  const suggestions = extractReminderSuggestions(payload);

  return {
    recordedAt,
    source,
    stage: typeof payload.stage === 'string' ? payload.stage.trim() : undefined,
    mode: typeof payload.mode === 'string' ? payload.mode.trim() : undefined,
    suggestions,
  };
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : undefined;
}

const STAGE_ALIASES = new Map(
  [
    ['behavioral', 'Behavioral'],
    ['behavioural', 'Behavioral'],
    ['behavior', 'Behavioral'],
    ['technical', 'Technical'],
    ['coding', 'Technical'],
    ['system design', 'System Design'],
    ['system-design', 'System Design'],
    ['system_design', 'System Design'],
    ['design', 'System Design'],
    ['screen', 'Screen'],
    ['phone screen', 'Screen'],
    ['phone-screen', 'Screen'],
    ['phone_screen', 'Screen'],
    ['take home', 'Take-Home'],
    ['take-home', 'Take-Home'],
    ['takehome', 'Take-Home'],
    ['onsite', 'Onsite'],
    ['on site', 'Onsite'],
    ['on-site', 'Onsite'],
  ].map(([key, value]) => [key, value]),
);

function normalizeStageName(stage) {
  const value = sanitizeString(stage);
  if (!value) return 'Behavioral';
  const key = value.toLowerCase();
  const normalizedKey = key.replace(/\s+/g, ' ');
  return (
    STAGE_ALIASES.get(key) ||
    STAGE_ALIASES.get(normalizedKey) ||
    'Behavioral'
  );
}

function resolveDurationOverride(durationMinutes, fallback) {
  const numeric = Number(durationMinutes);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }
  return fallback;
}

const PLAN_LIBRARY = {
  Behavioral: {
    duration: 45,
    summary(role) {
      if (role) {
        return (
          `Prepare behavioral narratives that highlight ${role} impact using the ` +
          'STAR framework.'
        );
      }
      return (
        'Prepare behavioral narratives that highlight your impact using the ' +
        'STAR framework.'
      );
    },
    sections(role) {
      const lowerRole = role ? role.toLowerCase() : undefined;
      const warmupLine = role
        ? (
            `Outline three STAR stories aligned with ${role} responsibilities ` +
            '(leadership, conflict, delivery).'
          )
        : 'Outline three STAR stories covering leadership, conflict, and delivery.';
      const alignmentTarget = lowerRole
        ? `${lowerRole} stakeholders`
        : 'stakeholders';
      return [
        {
          title: 'Warm-up',
          items: [
            warmupLine,
            'Identify quantified outcomes and supporting metrics for each story.',
          ],
        },
        {
          title: 'Core practice',
          items: [
            'Rehearse “Tell me about yourself” with a concise two-minute arc.',
            'Practice a conflict resolution example emphasizing cross-team alignment ' +
              `${alignmentTarget} care about.`,
          ],
        },
        {
          title: 'Reflection',
          items: [
            'Capture follow-up questions to ask the interviewer.',
            'Record gaps or weaker stories to revisit in the next rehearsal.',
          ],
        },
      ];
    },
    resources: ['STAR template cheat sheet', 'Behavioral question bank'],
    flashcards: [
      {
        front: 'STAR checkpoint',
        back: 'Anchor stories around Situation, Task, Action, Result.',
      },
      {
        front: 'Leadership reflection',
        back: 'Highlight quantified impact and stakeholder outcomes.',
      },
    ],
    questionBank: [
      {
        prompt: 'Tell me about a time you resolved a conflict with a teammate.',
        tags: ['Leadership', 'Conflict'],
      },
      {
        prompt: 'Describe a situation where you influenced without authority.',
        tags: ['Influence'],
      },
    ],
    dialogTree: [
      {
        id: 'opener',
        prompt: 'Walk me through a recent project you led end-to-end.',
        followUps: [
          'What made it high impact for the business?',
          'Which metrics or signals proved it worked?',
          'How did you bring partners along the way?',
        ],
      },
      {
        id: 'resilience',
        prompt: 'Share a time you navigated conflict with a stakeholder.',
        followUps: [
          'How did you surface the disagreement early?',
          'What trade-offs or data helped resolve it?',
        ],
      },
    ],
  },
  Screen: {
    duration: 30,
    summary(role) {
      if (role) {
        return (
          `Guide the ${role} recruiter screen with a crisp narrative and clear logistics.`
        );
      }
      return 'Guide the recruiter screen with a crisp narrative and clear logistics.';
    },
    sections(role) {
      const roleContext = role ? `${role} opportunity` : 'opportunity';
      return [
        {
          title: 'Pitch warm-up',
          items: [
            `Draft a 60-second story tying recent wins to the ${roleContext}.`,
            'Line up 2-3 follow-up examples with metrics and outcomes ready to share.',
          ],
        },
        {
          title: 'Signals to surface',
          items: [
            'Highlight motivators, team fit, and collaboration stories recruiters expect.',
            'List clarifying questions about team structure, expectations, and support.',
          ],
        },
        {
          title: 'Logistics & next steps',
          items: [
            'Confirm timeline, interview loop, and decision process before hanging up.',
            'Prepare salary, location, and availability guardrails with data points.',
          ],
        },
      ];
    },
    resources: ['Recruiter alignment checklist', 'Compensation research worksheet'],
    flashcards: [
      {
        front: 'Recruiter pitch',
        back: 'Lead with mission, role fit, and a metric-rich win in 60 seconds.',
      },
      {
        front: 'Close strong',
        back: 'Confirm next steps, logistics, and send a same-day thank-you.',
      },
    ],
    questionBank: [
      {
        prompt: 'What drew you to this opportunity?',
        tags: ['Motivation'],
      },
      {
        prompt: 'What are your compensation expectations?',
        tags: ['Compensation'],
      },
    ],
    dialogTree: [
      {
        id: 'opener',
        prompt: 'Walk me through your background for a recruiter screen.',
        followUps: [
          'Which highlights resonate most with this role?',
          'How do you connect recent wins to the team’s goals?',
        ],
      },
      {
        id: 'logistics',
        prompt: 'What logistics or constraints should we be aware of?',
        followUps: [
          'What timeline are you targeting for next steps?',
          'Are there location or scheduling constraints to share?',
        ],
      },
    ],
  },
  Technical: {
    duration: 60,
    summary(role) {
      if (role) {
        return (
          `Focus technical drills on the problem spaces ${role}s encounter while ` +
          'keeping debugging instincts sharp.'
        );
      }
      return (
        'Focus technical drills on core data structures, debugging patterns, and ' +
        'test-first habits.'
      );
    },
    sections(role) {
      const roleContext = role ? `${role} scenarios` : 'target systems';
      return [
        {
          title: 'Warm-up',
          items: [
            'Solve two medium algorithm prompts without an IDE to reinforce fundamentals.',
            'Review language-specific standard library helpers and edge-case handling.',
          ],
        },
        {
          title: 'Core practice',
          items: [
            'Implement a function test-first while narrating thought process and trade-offs.',
            `Walk through pair programming a debugging session based on ${roleContext}.`,
          ],
        },
        {
          title: 'Reflection',
          items: [
            'List edge cases or optimizations to revisit after the session.',
            'Capture instrumentation or tooling that would accelerate future debugging.',
          ],
        },
      ];
    },
    resources: ['Algorithm drill set', 'Language cheat sheet'],
    flashcards: [
      {
        front: 'Debugging loop',
        back: 'Reproduce → Inspect logs → Narrow scope → Verify fix.',
      },
      {
        front: 'Complexity radar',
        back: 'Check data structure trade-offs before coding.',
      },
    ],
    questionBank: [
      {
        prompt: 'Walk through how you would debug a memory leak in production.',
        tags: ['Debugging'],
      },
      {
        prompt: 'Implement an LRU cache and explain your trade-offs.',
        tags: ['Data Structures'],
      },
    ],
    dialogTree: [
      {
        id: 'debugging',
        prompt: 'Talk me through how you debug a failing integration test.',
        followUps: [
          'Which signals tell you the regression lives in your code?',
          'How do you keep collaborators unblocked while you investigate?',
        ],
      },
      {
        id: 'extension',
        prompt: 'Imagine the interviewer asks you to extend the solution mid-session.',
        followUps: [
          'What parts of your design change first?',
          'How do you verify performance after the change?',
        ],
      },
    ],
  },
  'System Design': {
    duration: 75,
    summary(role) {
      if (role) {
        return (
          `Draft scalable architectures that showcase how a ${role} balances user ` +
          'impact with reliability.'
        );
      }
      return 'Draft scalable architectures that balance user impact, cost, and reliability.';
    },
    sections(role) {
      const roleSuffix = role ? ` for ${role} use cases` : '';
      return [
        {
          title: 'Requirements',
          items: [
            'Clarify functional and non-functional requirements along with success metrics.',
            'List constraints around traffic, latency budgets, data retention, and compliance.',
          ],
        },
        {
          title: 'Architecture',
          items: [
            'Sketch the high-level architecture with labeled components, data flow, and ' +
              `ownership${roleSuffix}.`,
            'Outline storage choices, consistency trade-offs, and critical dependencies.',
          ],
        },
        {
          title: 'Scaling & reliability',
          items: [
            'Estimate capacity, identify bottlenecks, and outline mitigation strategies.',
            'Define observability signals, failure modes, and a rollout or migration plan.',
          ],
        },
        {
          title: 'Reflection',
          items: [
            'Document follow-up topics or gaps to research before the next session.',
            'Summarize trade-offs to communicate during the interview debrief.',
          ],
        },
      ];
    },
    resources: ['System design checklist', 'Capacity planning worksheet'],
    flashcards: [
      {
        front: 'Capacity planning',
        back: 'Quantify QPS, latency budgets, and storage needs upfront.',
      },
      {
        front: 'Resilience checklist',
        back: 'Map failure domains, redundancy, and rollback strategies.',
      },
    ],
    questionBank: [
      {
        prompt: 'Design a multi-region feature flag service.',
        tags: ['Reliability'],
      },
      {
        prompt: 'Scale a read-heavy API to millions of users.',
        tags: ['Scalability'],
      },
    ],
    dialogTree: [
      {
        id: 'scope',
        prompt: 'Clarify requirements for a global notifications platform.',
        followUps: [
          'What volume and latency targets anchor your design?',
          'Which compliance or privacy constraints shape the architecture?',
        ],
      },
      {
        id: 'deep-dive',
        prompt: 'Pick one bottleneck you expect and walk through mitigation steps.',
        followUps: [
          'What telemetry proves the mitigation is working?',
          'How would you stage the rollout to limit risk?',
        ],
      },
    ],
  },
  Onsite: {
    duration: 150,
    summary(role) {
      if (role) {
        return (
          `Coordinate the ${role} onsite loop with smooth transitions, steady energy, ` +
          'and clear follow-ups.'
        );
      }
      return (
        'Coordinate the onsite loop with smooth transitions, steady energy, and clear follow-ups.'
      );
    },
    sections(role) {
      const panelLabel = role ? `${role} panel` : 'panel';
      return [
        {
          title: 'Agenda review',
          items: [
            'Confirm interview schedule, formats, and expectations with your recruiter.',
            `Note interviewer backgrounds and tailor intros for each ${panelLabel}.`,
          ],
        },
        {
          title: 'Energy & logistics',
          items: [
            'Plan meals, breaks, wardrobe, workspace, and travel buffers for the onsite day.',
            'Stage materials (resume variants, notebook, metrics) and reminders for check-ins.',
          ],
        },
        {
          title: 'Story rotation',
          items: [
            'Map STAR stories to each session and vary examples across interviews.',
            'List clarifying questions to open and close each room confidently.',
          ],
        },
        {
          title: 'Follow-up',
          items: [
            'Draft thank-you note bullet points per interviewer while details are fresh.',
            'Capture risks, commitments, and next steps immediately after the loop.',
          ],
        },
      ];
    },
    resources: ['Onsite checklist', 'Thank-you note templates'],
    flashcards: [
      {
        front: 'Panel transitions',
        back: 'Reset, summarize, and confirm expectations between interviews.',
      },
      {
        front: 'Energy reset',
        back: 'Plan hydration, nutrition, and breaks to stay sharp all day.',
      },
    ],
    questionBank: [
      {
        prompt: 'How will you tailor your opener for each onsite session?',
        tags: ['Communication'],
      },
      {
        prompt: 'What signals do you want every interviewer to carry into the debrief?',
        tags: ['Strategy'],
      },
    ],
    dialogTree: [
      {
        id: 'transitions',
        prompt: 'Walk me through how you reset between onsite sessions and stay present.',
        followUps: [
          'What cues help you tailor intros for each interviewer?',
          'How do you capture notes for thank-you follow-ups before the next room?',
        ],
      },
      {
        id: 'debrief',
        prompt: 'Outline your plan for the onsite debrief once the loop wraps up.',
        followUps: [
          'Which signals confirm the loop went well or needs triage?',
          'How do you close the loop on commitments after the thank-you emails?',
        ],
      },
    ],
  },
  'Take-Home': {
    duration: 90,
    summary(role) {
      if (role) {
        return (
          `Plan a structured take-home workflow that mirrors how a ${role} balances ` +
          'speed with clarity.'
        );
      }
      return 'Plan a structured take-home workflow that balances speed with clarity.';
    },
    sections() {
      return [
        {
          title: 'Plan',
          items: [
            'Review the prompt, clarify assumptions, and list explicit deliverables.',
            'Break work into milestones with time estimates and checkpoints.',
          ],
        },
        {
          title: 'Implementation',
          items: [
            'Set up the repository, tests, and tooling before writing feature code.',
            'Commit checkpoints with notes explaining trade-offs and open questions.',
          ],
        },
        {
          title: 'Review & delivery',
          items: [
            'Run linting, formatting, and tests before packaging the submission.',
            'Polish the README or summary email highlighting decisions and follow-up items.',
          ],
        },
      ];
    },
    resources: ['Take-home checklist', 'Take-home submission rubric'],
    flashcards: [
      {
        front: 'Submission polish',
        back: 'Budget time for README, tests, and sanity checks.',
      },
      {
        front: 'Commit hygiene',
        back: 'Write focused commits with notes on trade-offs and TODOs.',
      },
    ],
    questionBank: [
      {
        prompt: 'Outline how you would plan a 48-hour take-home assignment.',
        tags: ['Planning'],
      },
      {
        prompt: 'Describe how you communicate scope adjustments to reviewers.',
        tags: ['Communication'],
      },
    ],
    dialogTree: [
      {
        id: 'planning',
        prompt: 'Describe how you plan the first hour of a take-home assignment.',
        followUps: [
          'What questions do you send the reviewer before starting?',
          'How do you budget time for tests and polish?',
        ],
      },
      {
        id: 'handoff',
        prompt: 'Explain how you package the final deliverable for review.',
        followUps: [
          'What context goes into the README or summary email?',
          'How do you highlight trade-offs for future iterations?',
        ],
      },
    ],
  },
};

export function generateRehearsalPlan(options = {}) {
  const normalizedStage = normalizeStageName(options.stage);
  const template = PLAN_LIBRARY[normalizedStage] || PLAN_LIBRARY.Behavioral;
  const role = sanitizeString(options.role);
  const duration = resolveDurationOverride(options.durationMinutes, template.duration);
  const sections = template.sections(role).map(section => ({
    title: section.title,
    items: section.items.slice(),
  }));
  const flashcards = Array.isArray(template.flashcards)
    ? template.flashcards
        .map(card => {
          const front = sanitizeString(card.front);
          const back = sanitizeString(card.back);
          if (!front || !back) return null;
          return { front, back };
        })
        .filter(Boolean)
    : [];
  const questionBank = Array.isArray(template.questionBank)
    ? template.questionBank
        .map(entry => {
          const prompt = sanitizeString(entry.prompt);
          if (!prompt) return null;
          let tags;
          if (Array.isArray(entry.tags) && entry.tags.length) {
            const normalized = [];
            const seen = new Set();
            for (const tag of entry.tags) {
              const value = sanitizeString(tag);
              if (!value) continue;
              const key = value.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              normalized.push(value);
            }
            if (normalized.length) tags = normalized;
          }
          return tags ? { prompt, tags } : { prompt };
        })
        .filter(Boolean)
    : [];
  const dialogTree = Array.isArray(template.dialogTree)
    ? template.dialogTree
        .map(node => {
          const prompt = sanitizeString(node.prompt);
          if (!prompt) return null;
          const id = sanitizeString(node.id);
          const followUps = Array.isArray(node.followUps)
            ? node.followUps
                .map(entry => sanitizeString(entry))
                .filter(Boolean)
            : [];
          const payload = { prompt };
          if (id) payload.id = id;
          if (followUps.length > 0) payload.follow_ups = followUps;
          return payload;
        })
        .filter(Boolean)
    : [];

  return {
    stage: normalizedStage,
    role: role || undefined,
    duration_minutes: duration,
    summary: template.summary(role),
    sections,
    resources: template.resources.slice(),
    flashcards,
    question_bank: questionBank,
    dialog_tree: dialogTree,
  };
}

const SYSTEM_DESIGN_OUTLINE_TEMPLATE = {
  duration: 75,
  summary(role) {
    if (role) {
      return (
        `System design outline tailored for a ${role} interview. ` +
        'Use it to pace kickoff, architecture, scaling, and wrap-up segments.'
      );
    }
    return 'System design outline spans kickoff, architecture, scaling, operations, and wrap-up.';
  },
  segments(role) {
    const roleSuffix = role ? ` for ${role}` : '';
    return [
      {
        title: 'Kickoff (0-5 min)',
        goal: 'Align on user goals, success metrics, and explicit constraints.',
        prompts: [
          'Restate the scenario, primary users, and pain points to confirm understanding.',
          'Ask about traffic expectations, latency targets, and data retention requirements.',
        ],
        checkpoints: [
          'Agree on the primary workflow to optimize and the definition of success.',
          'Capture must-haves versus nice-to-haves to guard the remaining discussion.',
        ],
      },
      {
        title: `Architecture (5-20 min)${roleSuffix ? ` — ${roleSuffix.trim()}` : ''}`,
        goal: 'Sketch core components, data flow, and ownership boundaries.',
        prompts: [
          'Propose core services, queues, and data stores that satisfy the requirements.',
          'Explain how requests flow through the system and highlight trust boundaries.',
        ],
        checkpoints: [
          'Identify sources of truth, caches, and asynchronous pipelines.',
          'Call out external dependencies, failure domains, and isolation strategies.',
        ],
      },
      {
        title: 'Scaling & reliability (20-45 min)',
        goal: 'Stress test throughput, storage growth, and resilience strategies.',
        prompts: [
          'Quantify capacity assumptions (QPS, fan-out, storage growth) and revisit throughout.',
          'Describe how you will scale hot paths (partitioning, replication, caching).',
          'Discuss consistency and availability trade-offs plus mitigation plans.',
        ],
        checkpoints: [
          'Name the first bottleneck you expect and the instrumentation that would detect it.',
          'Detail degradation modes and fallback behavior for critical user journeys.',
        ],
      },
      {
        title: 'Operations & observability (45-70 min)',
        goal: 'Cover deployment, telemetry, and incident response expectations.',
        prompts: [
          'Outline logging, metrics, and tracing signals plus alerting thresholds.',
          'Explain deployment, rollback, and migration workflows, including data safety.',
        ],
        checkpoints: [
          'List SLIs/SLOs that demonstrate the design is healthy after launch.',
          'Describe on-call runbooks, escalation paths, and ownership hand-offs.',
        ],
      },
      {
        title: 'Wrap-up (70-75 min)',
        goal: 'Summarize trade-offs, risks, and next steps for the debrief.',
        prompts: [
          'Recap strengths, weaknesses, and open questions to investigate later.',
          'Offer trade-offs you would revisit with more time or new constraints.',
        ],
        checkpoints: [
          'Confirm follow-up experiments, metrics, or artifacts you owe the team.',
          'Frame the closing narrative that you will deliver in the interview debrief.',
        ],
      },
    ];
  },
  checklists: [
    {
      title: 'Diagram essentials',
      items: [
        'Label data-flow arrows with protocols, latency budgets, and owners.',
        'Mark read versus write paths plus components responsible for state changes.',
        'Highlight external dependencies, authentication boundaries, and rate limits.',
      ],
    },
    {
      title: 'Operational readiness',
      items: [
        'Define rollback and recovery strategies before the design ships.',
        'List alerts that would page on-call and the source metrics powering them.',
        'Capture launch risks with mitigation owners for follow-up.',
      ],
    },
  ],
  followUps: [
    'Which trade-offs would you revisit with more time or real traffic data?',
    'How would the design evolve to handle 10x traffic or new regions?',
    'What telemetry confirms the design is healthy after launch?',
  ],
};

export function generateSystemDesignOutline(options = {}) {
  const role = sanitizeString(options.role);
  const duration = resolveDurationOverride(
    options.durationMinutes,
    SYSTEM_DESIGN_OUTLINE_TEMPLATE.duration,
  );
  const summary = SYSTEM_DESIGN_OUTLINE_TEMPLATE.summary(role);
  const segments = SYSTEM_DESIGN_OUTLINE_TEMPLATE.segments(role).map(segment => ({
    title: segment.title,
    goal: segment.goal,
    prompts: segment.prompts.slice(),
    checkpoints: segment.checkpoints.slice(),
  }));
  const checklists = SYSTEM_DESIGN_OUTLINE_TEMPLATE.checklists.map(checklist => ({
    title: checklist.title,
    items: checklist.items.slice(),
  }));

  return {
    stage: 'System Design',
    role: role || undefined,
    duration_minutes: duration,
    summary,
    segments,
    checklists,
    follow_up_questions: SYSTEM_DESIGN_OUTLINE_TEMPLATE.followUps.slice(),
  };
}

function ensureSafeIdentifier(value, label) {
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} cannot contain path separators`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`${label} cannot reference parent directories`);
  }
  return value;
}

function requireId(value, label) {
  const sanitized = sanitizeString(value);
  if (!sanitized) {
    throw new Error(`${label} is required`);
  }
  return ensureSafeIdentifier(sanitized, label);
}

function normalizeTimestamp(input, label) {
  if (input == null) return undefined;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${label} timestamp: ${input}`);
  }
  return date.toISOString();
}

function normalizeTranscript(input) {
  if (input == null) return undefined;
  const value = sanitizeString(input);
  if (!value) {
    throw new Error('transcript cannot be empty');
  }
  return value;
}

const WORD_PATTERN = /[\p{L}\p{N}']+/gu;

function countWords(text) {
  if (!text) return 0;
  const matches = text.match(WORD_PATTERN);
  return matches ? matches.length : 0;
}

function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/[.!?]+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function roundToSingleDecimal(value) {
  if (!Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? Math.trunc(rounded) : rounded;
}

const FILLER_PATTERNS = [
  { key: 'um', pattern: /\bum+\b/gi },
  { key: 'uh', pattern: /\buh+\b/gi },
  { key: 'like', pattern: /\blike\b/gi },
  { key: 'you know', pattern: /\byou\s+know\b/gi },
  { key: 'kind of', pattern: /\bkind\s+of\b/gi },
  { key: 'sort of', pattern: /\bsort\s+of\b/gi },
  { key: 'actually', pattern: /\bactually\b/gi },
  { key: 'basically', pattern: /\bbasically\b/gi },
];

function collectFillerWords(text) {
  if (!text) {
    return { total: 0, counts: {} };
  }
  const lower = text.toLowerCase();
  const counts = {};
  let total = 0;
  for (const { key, pattern } of FILLER_PATTERNS) {
    const matches = lower.match(pattern);
    if (!matches) continue;
    counts[key] = matches.length;
    total += matches.length;
  }
  return { total, counts };
}

const STAR_COMPONENTS = ['situation', 'task', 'action', 'result'];

function detectStarComponents(text) {
  const mentioned = [];
  const missing = [];
  if (!text) {
    return { mentioned, missing: STAR_COMPONENTS.slice() };
  }
  for (const component of STAR_COMPONENTS) {
    const pattern = new RegExp(`\\b${component}\\b`, 'i');
    if (pattern.test(text)) mentioned.push(component);
    else missing.push(component);
  }
  return { mentioned, missing };
}

function computeWordsPerMinute(wordCount, startedAt, endedAt) {
  if (!startedAt || !endedAt) return undefined;
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return undefined;
  return roundToSingleDecimal(wordCount / durationMinutes);
}

function buildTightenThisCritique({
  wordCount,
  averageSentenceWords,
  filler,
  star,
}) {
  const suggestions = [];

  if (
    Number.isFinite(averageSentenceWords) &&
    averageSentenceWords !== undefined &&
    averageSentenceWords > 28
  ) {
    suggestions.push(
      `Tighten this: shorten sentences—average ${averageSentenceWords} words per sentence.`,
    );
  }

  if (wordCount > 220) {
    suggestions.push(
      `Tighten this: trim the response—${wordCount} words run long` +
        ' for this format.',
    );
  }

  if (filler && typeof filler.total === 'number' && filler.total > 0 && wordCount > 0) {
    const ratio = filler.total / wordCount;
    const percent = Math.round(ratio * 100);
    if (filler.total >= 3 || ratio >= 0.05) {
      suggestions.push(
        `Tighten this: reduce filler words—${filler.total} across ${wordCount} words` +
          ` (~${percent}%).`,
      );
    }
  }

  const missingStar = Array.isArray(star?.missing) ? star.missing.filter(Boolean) : [];
  if (missingStar.length > 0) {
    suggestions.push(
      `Tighten this: add STAR coverage for ${missingStar.join(', ')}.`,
    );
  }

  return suggestions;
}

function buildTranscriptHeuristics({ transcript, startedAt, endedAt }) {
  if (!transcript) return undefined;
  const wordCount = countWords(transcript);
  const sentences = splitSentences(transcript);
  const filler = collectFillerWords(transcript);
  const star = detectStarComponents(transcript);

  const heuristics = {
    brevity: {
      word_count: wordCount,
      sentence_count: sentences.length,
      average_sentence_words: roundToSingleDecimal(
        sentences.length === 0 ? wordCount : wordCount / sentences.length,
      ),
    },
    filler_words: {
      total: filler.total,
      counts: filler.counts,
    },
    structure: {
      star,
    },
  };

  const tightenThis = buildTightenThisCritique({
    wordCount,
    averageSentenceWords: heuristics.brevity.average_sentence_words,
    filler,
    star,
  });

  heuristics.critique = { tighten_this: tightenThis };

  const wpm = computeWordsPerMinute(wordCount, startedAt, endedAt);
  if (wpm !== undefined) heuristics.brevity.estimated_wpm = wpm;

  return heuristics;
}

function normalizeNoteList(input, label) {
  if (input == null) return undefined;
  const items = Array.isArray(input) ? input : [input];
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const value = sanitizeString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return normalized;
}

function normalizeNotes(input) {
  if (input == null) return undefined;
  const value = sanitizeString(input);
  if (!value) {
    throw new Error('notes cannot be empty');
  }
  return value;
}

function normalizeRating(input) {
  if (input == null) return undefined;
  const value = typeof input === 'string' ? input.trim() : input;
  if (typeof value === 'string' && value === '') {
    throw new Error('rating cannot be empty');
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('rating must be between 1 and 5');
  }
  if (!Number.isInteger(numeric)) {
    throw new Error('rating must be an integer between 1 and 5');
  }
  if (numeric < 1 || numeric > 5) {
    throw new Error('rating must be between 1 and 5');
  }
  return numeric;
}

function normalizeAudioSource(input) {
  if (!input || typeof input !== 'object') return undefined;
  const type = sanitizeString(input.type) || 'file';
  if (type.toLowerCase() !== 'file') return undefined;
  const name =
    sanitizeString(input.name) ||
    sanitizeString(input.filename) ||
    sanitizeString(input.file) ||
    sanitizeString(input.path);
  if (!name) return undefined;
  return { type: 'file', name };
}

function resolveSessionPath(jobId, sessionId) {
  const baseDir = resolveDataDir();
  const jobDir = path.join(baseDir, 'interviews', jobId);
  return { jobDir, file: path.join(jobDir, `${sessionId}.json`) };
}

export async function recordInterviewSession(jobId, sessionId, data = {}) {
  const normalizedJobId = requireId(jobId, 'job id');
  const normalizedSessionId = requireId(sessionId, 'session id');

  const settings = await loadSettings();
  const privacySettings = settings?.privacy ?? DEFAULT_SETTINGS.privacy;
  const shouldStoreTranscript = privacySettings.storeInterviewTranscripts !== false;

  const transcript = normalizeTranscript(data.transcript);
  const reflections = normalizeNoteList(data.reflections, 'reflections');
  const feedback = normalizeNoteList(data.feedback, 'feedback');
  const notes = normalizeNotes(data.notes);
  const rating = normalizeRating(data.rating);
  const audioSource = normalizeAudioSource(data.audioSource ?? data.audio_source);

  const stage = sanitizeString(data.stage) || 'Behavioral';
  const mode = sanitizeString(data.mode) || 'Voice';
  const startedAt = normalizeTimestamp(data.startedAt ?? data.started_at, 'start');
  const endedAt = normalizeTimestamp(data.endedAt ?? data.ended_at, 'end');

  const { jobDir, file } = resolveSessionPath(normalizedJobId, normalizedSessionId);
  await fs.mkdir(jobDir, { recursive: true });

  const entry = {
    job_id: normalizedJobId,
    session_id: normalizedSessionId,
    recorded_at: new Date().toISOString(),
  };

  if (stage) entry.stage = stage;
  if (mode) entry.mode = mode;
  if (transcript && shouldStoreTranscript) entry.transcript = transcript;
  if (reflections) entry.reflections = reflections;
  if (feedback) entry.feedback = feedback;
  if (notes) entry.notes = notes;
  if (rating !== undefined) entry.rating = rating;
  if (audioSource) entry.audio_source = audioSource;
  if (startedAt) entry.started_at = startedAt;
  if (endedAt) entry.ended_at = endedAt;

  if (transcript) {
    const heuristics = buildTranscriptHeuristics({
      transcript,
      startedAt,
      endedAt,
    });
    if (heuristics) entry.heuristics = heuristics;
  }

  await fs.writeFile(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

  return { ...entry };
}

async function readSessionFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function getInterviewSession(jobId, sessionId) {
  const normalizedJobId = requireId(jobId, 'job id');
  const normalizedSessionId = requireId(sessionId, 'session id');
  const { file } = resolveSessionPath(normalizedJobId, normalizedSessionId);
  const data = await readSessionFile(file);
  return data ? { ...data } : null;
}

export async function listInterviewReminders(options = {}) {
  const now = resolveRemindersNow(options.now);
  const staleAfterDays = coerceReminderNumber(options.staleAfterDays, 'staleAfterDays') ?? 7;
  const staleThresholdMs = staleAfterDays * MS_PER_DAY;
  const root = path.join(resolveDataDir(), 'interviews');
  const jobEntries = await safeReadDir(root);
  const reminders = [];

  for (const entry of jobEntries) {
    if (!isVisibleDirectory(entry)) continue;
    const jobId = entry.name;
    const jobDir = path.join(root, jobId);
    const sessionEntries = await safeReadDir(jobDir);

    let sessionCount = 0;
    let latest;

    for (const sessionEntry of sessionEntries) {
      if (!isVisibleSessionFile(sessionEntry)) continue;
      const filePath = path.join(jobDir, sessionEntry.name);
      const session = await readReminderSession(filePath);
      if (!session) continue;
      sessionCount += 1;
      if (!session.recordedAt) continue;
      const timestamp = Date.parse(session.recordedAt);
      if (Number.isNaN(timestamp)) continue;
      if (!latest || timestamp > latest.timestamp) {
        latest = {
          timestamp,
          recordedAt: new Date(timestamp).toISOString(),
          stage: session.stage,
          mode: session.mode,
          suggestions: session.suggestions,
        };
      }
    }

    if (sessionCount === 0) {
      reminders.push({
        job_id: jobId,
        reason: 'no_sessions',
        sessions: 0,
        message: 'No rehearsal sessions have been recorded yet.',
      });
      continue;
    }

    if (!latest) {
      reminders.push({
        job_id: jobId,
        reason: 'no_sessions',
        sessions: sessionCount,
        message: 'Existing sessions are missing timestamps. Record a fresh rehearsal.',
      });
      continue;
    }

    const diffMs = now.getTime() - latest.timestamp;
    if (diffMs < staleThresholdMs) {
      continue;
    }

    const staleDays = Math.max(0, Math.floor(diffMs / MS_PER_DAY));
    const reminder = {
      job_id: jobId,
      reason: 'stale',
      sessions: sessionCount,
      last_session_at: latest.recordedAt,
      stale_for_days: staleDays,
    };
    if (latest.stage) reminder.stage = latest.stage;
    if (latest.mode) reminder.mode = latest.mode;
    if (latest.suggestions) reminder.suggestions = latest.suggestions;
    reminders.push(reminder);
  }

  reminders.sort((a, b) => {
    const orderA = a.reason === 'stale' ? 0 : 1;
    const orderB = b.reason === 'stale' ? 0 : 1;
    if (orderA !== orderB) return orderA - orderB;
    if (a.reason === 'stale' && b.reason === 'stale') {
      const diff = (b.stale_for_days ?? 0) - (a.stale_for_days ?? 0);
      if (diff !== 0) return diff;
    }
    return a.job_id.localeCompare(b.job_id);
  });

  return reminders;
}

function isVisibleSession(entry) {
  if (!entry || typeof entry.name !== 'string') return false;
  if (entry.name.startsWith('.')) return false;
  return entry.isFile() && entry.name.toLowerCase().endsWith('.json');
}

function coerceIsoTimestamp(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export async function exportInterviewSessions(jobId) {
  const normalizedJobId = requireId(jobId, 'job id');
  const jobDir = path.join(resolveDataDir(), 'interviews', normalizedJobId);

  let entries;
  try {
    entries = await fs.readdir(jobDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`No interview sessions found for ${normalizedJobId}`);
    }
    throw err;
  }

  const sessionFiles = entries.filter(isVisibleSession);
  if (sessionFiles.length === 0) {
    throw new Error(`No interview sessions found for ${normalizedJobId}`);
  }

  const zip = new JSZip();
  const sessions = [];

  for (const entry of sessionFiles) {
    const filePath = path.join(jobDir, entry.name);
    let contents;
    try {
      contents = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        continue;
      }
      throw err;
    }

    const relativePath = `sessions/${entry.name}`;
    zip.file(relativePath, contents);

    const summary = { file: relativePath };
    let payload;
    try {
      payload = JSON.parse(contents);
    } catch {
      payload = null;
    }

    if (payload && typeof payload === 'object') {
      if (typeof payload.session_id === 'string' && payload.session_id.trim()) {
        summary.session_id = payload.session_id.trim();
      }
      const recordedAt = coerceIsoTimestamp(payload.recorded_at);
      const startedAt = coerceIsoTimestamp(payload.started_at);
      if (recordedAt) {
        summary.recorded_at = recordedAt;
      } else if (startedAt) {
        summary.recorded_at = startedAt;
      }
      if (typeof payload.stage === 'string' && payload.stage.trim()) {
        summary.stage = payload.stage.trim();
      }
      if (typeof payload.mode === 'string' && payload.mode.trim()) {
        summary.mode = payload.mode.trim();
      }
    }

    sessions.push(summary);
  }

  if (sessions.length === 0) {
    throw new Error(`No interview sessions found for ${normalizedJobId}`);
  }

  sessions.sort((a, b) => {
    const aTime = a.recorded_at ? Date.parse(a.recorded_at) : NaN;
    const bTime = b.recorded_at ? Date.parse(b.recorded_at) : NaN;
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) return bTime - aTime;
    if (!Number.isNaN(aTime)) return -1;
    if (!Number.isNaN(bTime)) return 1;
    const aId = typeof a.session_id === 'string' ? a.session_id : '';
    const bId = typeof b.session_id === 'string' ? b.session_id : '';
    return aId.localeCompare(bId);
  });

  const manifest = {
    job_id: normalizedJobId,
    exported_at: new Date().toISOString(),
    total_sessions: sessions.length,
    sessions,
  };

  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
