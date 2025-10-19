import { lifecycleStateSchema } from '../domain/opportunity.js';

function normalizeLifecycleState(value, fallback) {
  try {
    return lifecycleStateSchema.parse(value);
  } catch {
    return fallback;
  }
}

export function computeSankeyEdges(events) {
  const edges = new Map();
  const stateByOpportunity = new Map();

  const sorted = [...events].sort((a, b) => {
    if (a.occurredAt === b.occurredAt) {
      return a.eventUid.localeCompare(b.eventUid);
    }
    return a.occurredAt.localeCompare(b.occurredAt);
  });

  for (const event of sorted) {
    const opportunityUid = event.opportunityUid;
    if (!opportunityUid) continue;
    const currentState = stateByOpportunity.get(opportunityUid) ?? 'recruiter_outreach';

    if (event.type === 'lifecycle_transition' && event.payload) {
      const nextState = normalizeLifecycleState(event.payload.to, currentState);
      if (nextState !== currentState) {
        const key = `${currentState}->${nextState}`;
        edges.set(key, {
          source: currentState,
          target: nextState,
          count: (edges.get(key)?.count ?? 0) + 1,
        });
        stateByOpportunity.set(opportunityUid, nextState);
      }
      continue;
    }

    if (event.type === 'phone_screen_scheduled') {
      const nextState = 'phone_screen_scheduled';
      if (nextState !== currentState) {
        const key = `${currentState}->${nextState}`;
        edges.set(key, {
          source: currentState,
          target: nextState,
          count: (edges.get(key)?.count ?? 0) + 1,
        });
        stateByOpportunity.set(opportunityUid, nextState);
      }
      continue;
    }

    if (event.type === 'phone_screen_completed') {
      const key = `${currentState}->phone_screen_done`;
      edges.set(key, {
        source: currentState,
        target: 'phone_screen_done',
        count: (edges.get(key)?.count ?? 0) + 1,
      });
      stateByOpportunity.set(opportunityUid, 'phone_screen_done');
    }
  }

  return Array.from(edges.values());
}
