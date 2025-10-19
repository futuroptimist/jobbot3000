import { createHash } from 'node:crypto';

import { lifecycleStateSchema } from './opportunity.js';

const transitions = {
  recruiter_outreach: ['phone_screen_scheduled', 'closed'],
  phone_screen_scheduled: ['phone_screen_done', 'closed'],
  phone_screen_done: ['onsite_scheduled', 'offer_received', 'closed'],
  onsite_scheduled: ['offer_received', 'closed'],
  offer_received: ['offer_declined', 'offer_accepted', 'closed'],
  offer_declined: ['closed'],
  offer_accepted: ['closed'],
  closed: [],
};

export function getAllowedTransitions(state) {
  return transitions[state] ?? [];
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function computeEventUid(opportunityUid, from, to, occurredAt, note) {
  const hash = createHash('sha256');
  hash.update(opportunityUid);
  hash.update('|');
  hash.update(from);
  hash.update('|');
  hash.update(to);
  hash.update('|');
  hash.update(occurredAt);
  hash.update('|');
  hash.update(note ?? '');
  return hash.digest('hex');
}

export function applyLifecycleTransition(opportunityUid, currentState, transition) {
  const normalizedTo = lifecycleStateSchema.parse(transition.to);
  const allowed = getAllowedTransitions(currentState);
  if (!allowed.includes(normalizedTo)) {
    throw new Error(`invalid lifecycle transition from ${currentState} to ${normalizedTo}`);
  }

  const occurredAt = normalizeTimestamp(transition.occurredAt);
  const eventUid = computeEventUid(
    opportunityUid,
    currentState,
    normalizedTo,
    occurredAt,
    transition.note,
  );

  return {
    lifecycleState: normalizedTo,
    occurredAt,
    event: {
      eventUid,
      opportunityUid,
      type: 'lifecycle_transition',
      occurredAt,
      payload: {
        from: currentState,
        to: normalizedTo,
        ...(transition.note ? { note: transition.note } : {}),
      },
    },
  };
}
