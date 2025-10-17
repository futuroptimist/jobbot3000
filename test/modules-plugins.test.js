import { describe, it, expect, vi } from 'vitest';

import { createModuleEventBus } from '../src/shared/events/bus.js';
import { registerPluginsModule } from '../src/modules/plugins/index.js';

function createLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
}

describe('registerPluginsModule', () => {
  it('registers plugins, events, and exposes metadata', async () => {
    const bus = createModuleEventBus();
    const logger = createLogger();
    const registerCalls = [];
    const eventCalls = [];
    const plugin = {
      id: 'calendar-sync',
      description: 'Calendar automation bridge',
      register(context) {
        registerCalls.push({ id: context.id, options: context.options });
        return () => {
          registerCalls.push({ disposed: true });
        };
      },
      events: {
        'analytics:report': (payload, context) => {
          context.options.processed = true;
          eventCalls.push({ payload, options: context.options });
        },
      },
    };

    const config = { plugins: [{ id: 'calendar-sync', options: { timezone: 'UTC' } }] };
    const dispose = registerPluginsModule({
      bus,
      config,
      plugins: [plugin],
      logger,
    });

    await bus.emit('analytics:report', { jobId: '123' });

    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0].id).toBe('calendar-sync');
    expect(registerCalls[0].options).toEqual({ timezone: 'UTC', processed: true });
    expect(registerCalls[0].options).not.toBe(config.plugins[0].options);
    expect(eventCalls).toEqual([
      {
        payload: { jobId: '123' },
        options: { timezone: 'UTC', processed: true },
      },
    ]);
    expect(config.plugins[0].options).toEqual({ timezone: 'UTC' });

    const metadata = await bus.dispatch('plugins:list');
    expect(metadata).toEqual([
      {
        id: 'calendar-sync',
        description: 'Calendar automation bridge',
        events: ['analytics:report'],
        options: { timezone: 'UTC' },
      },
    ]);

    dispose();
    expect(registerCalls[1]).toEqual({ disposed: true });
  });

  it('skips plugins that are explicitly disabled', () => {
    const bus = createModuleEventBus();
    const logger = createLogger();
    const register = vi.fn();
    register.mockReturnValue(() => {});

    registerPluginsModule({
      bus,
      config: { plugins: [{ id: 'crm-sync', enabled: false }] },
      plugins: [{ id: 'crm-sync', register, events: {} }],
      logger,
    });

    expect(register).not.toHaveBeenCalled();
  });

  it('warns when configuration references an unknown plugin id', () => {
    const bus = createModuleEventBus();
    const logger = createLogger();

    registerPluginsModule({
      bus,
      config: { plugins: [{ id: 'unknown-plugin' }] },
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Plugin definition not found for id "unknown-plugin"'),
    );
  });

  it('throws when duplicate plugin identifiers are provided', () => {
    const bus = createModuleEventBus();

    expect(() =>
      registerPluginsModule({
        bus,
        plugins: [
          { id: 'duplicate', events: { 'app:event': () => {} } },
          { id: 'duplicate', register: () => () => {} },
        ],
      }),
    ).toThrow(/already registered/);
  });
});
