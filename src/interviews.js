import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setInterviewDataDir(dir) {
  overrideDir = dir || undefined;
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

  const transcript = normalizeTranscript(data.transcript);
  const reflections = normalizeNoteList(data.reflections, 'reflections');
  const feedback = normalizeNoteList(data.feedback, 'feedback');
  const notes = normalizeNotes(data.notes);
  const audioSource = normalizeAudioSource(data.audioSource ?? data.audio_source);

  if (!transcript && !reflections && !feedback && !notes) {
    throw new Error('at least one session field is required');
  }

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
  if (transcript) entry.transcript = transcript;
  if (reflections) entry.reflections = reflections;
  if (feedback) entry.feedback = feedback;
  if (notes) entry.notes = notes;
  if (audioSource) entry.audio_source = audioSource;
  if (startedAt) entry.started_at = startedAt;
  if (endedAt) entry.ended_at = endedAt;

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
