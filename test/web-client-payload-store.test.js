import { describe, expect, it } from 'vitest';

import { createClientPayloadStore } from '../src/web/client-payload-store.js';

describe('client payload store', () => {
  it('drops history entries when payload and result sanitize to empty', () => {
    const store = createClientPayloadStore({ maxEntriesPerClient: 3 });

    const recorded = store.record('client-1', 'summarize', { note: '   ' }, undefined);

    expect(recorded).toBeNull();
    expect(store.getRecent('client-1')).toEqual([]);
  });
});
