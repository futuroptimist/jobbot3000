function sanitizeNonEmptyString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  return trimmed;
}

function sanitizeOptionalString(value) {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('expected a string value');
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeOptionalBoolean(value) {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error('boolean flag must be true or false');
}

function sanitizeIsoDate(value, fieldName = 'date') {
  if (value == null) return undefined;
  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${fieldName} cannot be empty`);
    }
    date = new Date(trimmed);
  } else {
    throw new Error(`${fieldName} must be a string or Date`);
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${fieldName}: ${value}`);
  }
  return date.toISOString();
}

function sanitizeStringArray(value, fieldName, { minimum = 1, caseInsensitive = true } = {}) {
  if (value == null) {
    throw new Error(`${fieldName} is required`);
  }
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (!list) {
    throw new Error(`${fieldName} must be a string or array of strings`);
  }

  const deduped = [];
  const seen = new Set();
  for (const entry of list) {
    const trimmed = sanitizeNonEmptyString(entry, `${fieldName} entry`);
    const key = caseInsensitive ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }

  if (deduped.length < minimum) {
    throw new Error(
      `${fieldName} must include at least ${minimum} value${minimum === 1 ? '' : 's'}`,
    );
  }
  return deduped;
}

function ensureCommandPath(command) {
  if (!Array.isArray(command) || command.length !== 2) {
    throw new Error('command must be a tuple like ["shortlist", "list"]');
  }
  const [groupRaw, actionRaw] = command;
  const group = sanitizeNonEmptyString(groupRaw, 'command group').toLowerCase();
  const action = sanitizeNonEmptyString(actionRaw, 'command action').toLowerCase();
  return [group, action];
}

function buildShortlistListInvocation(request) {
  const filters = request.filters ?? {};
  const args = ['list'];

  const location = sanitizeOptionalString(filters.location ?? request.location);
  if (location) args.push('--location', location);

  const level = sanitizeOptionalString(filters.level ?? request.level);
  if (level) args.push('--level', level);

  const compensation = sanitizeOptionalString(filters.compensation ?? request.compensation);
  if (compensation) args.push('--compensation', compensation);

  const tagsValue = filters.tags ?? request.tags;
  if (tagsValue != null) {
    const tags = sanitizeStringArray(tagsValue, 'filters.tags');
    for (const tag of tags) {
      args.push('--tag', tag);
    }
  }

  const json = sanitizeOptionalBoolean(request.json);
  if (json) args.push('--json');

  const out = sanitizeOptionalString(request.out);
  if (out) {
    if (!json) {
      throw new Error('--json must be true when specifying an output path');
    }
    args.push('--out', out);
  }

  return { command: 'shortlist', args };
}

function buildShortlistSyncInvocation(request) {
  const jobId = sanitizeNonEmptyString(request.jobId, 'job id');
  const metadata = request.metadata ?? {};
  const args = ['sync', jobId];

  const location = sanitizeOptionalString(metadata.location ?? request.location);
  if (location) args.push('--location', location);

  const level = sanitizeOptionalString(metadata.level ?? request.level);
  if (level) args.push('--level', level);

  const compensation = sanitizeOptionalString(metadata.compensation ?? request.compensation);
  if (compensation) args.push('--compensation', compensation);

  const syncedAt = sanitizeIsoDate(
    metadata.syncedAt ?? metadata.synced_at ?? request.syncedAt ?? request.synced_at,
    'syncedAt',
  );
  if (syncedAt) args.push('--synced-at', syncedAt);

  return { command: 'shortlist', args };
}

function buildShortlistTagInvocation(request) {
  const jobId = sanitizeNonEmptyString(request.jobId, 'job id');
  const tags = sanitizeStringArray(request.tags, 'tags');
  return { command: 'shortlist', args: ['tag', jobId, ...tags] };
}

function buildShortlistDiscardInvocation(request) {
  const jobId = sanitizeNonEmptyString(request.jobId, 'job id');
  const reason = sanitizeNonEmptyString(request.reason, 'reason');
  const args = ['discard', jobId, '--reason', reason];

  const date = sanitizeIsoDate(request.date, 'date');
  if (date) args.push('--date', date);

  if (request.tags != null) {
    const tags = sanitizeStringArray(request.tags, 'tags');
    args.push('--tags', tags.join(','));
  }

  return { command: 'shortlist', args };
}

function buildShortlistArchiveInvocation(request) {
  const args = ['archive'];
  const jobId = sanitizeOptionalString(request.jobId);
  if (jobId) args.push(jobId);

  if (sanitizeOptionalBoolean(request.json)) {
    args.push('--json');
  }

  return { command: 'shortlist', args };
}

function buildTrackRemindersInvocation(request) {
  const args = ['reminders'];
  if (sanitizeOptionalBoolean(request.json)) args.push('--json');
  if (sanitizeOptionalBoolean(request.upcomingOnly)) args.push('--upcoming-only');
  const now = sanitizeIsoDate(request.now, 'now');
  if (now) args.push('--now', now);
  return { command: 'track', args };
}

function buildTrackBoardInvocation(request) {
  const args = ['board'];
  if (sanitizeOptionalBoolean(request.json)) args.push('--json');
  return { command: 'track', args };
}

const COMMAND_MATRIX = {
  shortlist: {
    list: buildShortlistListInvocation,
    sync: buildShortlistSyncInvocation,
    tag: buildShortlistTagInvocation,
    discard: buildShortlistDiscardInvocation,
    archive: buildShortlistArchiveInvocation,
  },
  track: {
    reminders: buildTrackRemindersInvocation,
    board: buildTrackBoardInvocation,
  },
};

export function listAllowedCommands() {
  const entries = [];
  for (const [group, actions] of Object.entries(COMMAND_MATRIX)) {
    for (const action of Object.keys(actions)) {
      entries.push(`${group}.${action}`);
    }
  }
  entries.sort((a, b) => a.localeCompare(b));
  return entries;
}

export function createCliInvocation(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('request must be an object');
  }
  const [group, action] = ensureCommandPath(request.command);
  const groupEntry = COMMAND_MATRIX[group];
  if (!groupEntry) {
    throw new Error(`unsupported command group: ${group}`);
  }
  const builder = groupEntry[action];
  if (!builder) {
    throw new Error(`unsupported command: ${group}.${action}`);
  }
  return builder(request);
}
