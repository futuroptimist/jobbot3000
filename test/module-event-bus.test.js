import { describe, expect, it } from 'vitest';

import { createModuleEventBus } from '../src/shared/events/bus.js';

describe('ModuleEventBus', () => {
  it('dispatches events to registered handlers', async () => {
    const bus = createModuleEventBus();
    let received = null;
    bus.registerHandler('ping', payload => {
      received = payload;
      return 'pong';
    });

    const result = await bus.dispatch('ping', { hello: 'world' });
    expect(received).toEqual({ hello: 'world' });
    expect(result).toBe('pong');
  });

  it('throws when registering multiple handlers for the same event', () => {
    const bus = createModuleEventBus();
    bus.registerHandler('command', () => {});
    expect(() => bus.registerHandler('command', () => {})).toThrow(/already registered/i);
  });
});
