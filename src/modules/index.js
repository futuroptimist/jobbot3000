import { createModuleEventBus } from '../shared/events/bus.js';
import { registerAuthModule } from './auth/index.js';
import { registerScrapingModule } from './scraping/index.js';
import { registerEnrichmentModule } from './enrichment/index.js';
import { registerScoringModule } from './scoring/index.js';
import { registerNotificationsModule } from './notifications/index.js';
import { registerPluginsModule } from './plugins/index.js';

export function bootstrapModules(options = {}) {
  const bus = options.bus ?? createModuleEventBus({ logger: options.logger });
  const config = options.config ?? {};
  const disposers = [];

  disposers.push(registerAuthModule({ bus, config }));
  disposers.push(registerScrapingModule({ bus, config }));
  disposers.push(registerEnrichmentModule({ bus, config }));
  disposers.push(registerScoringModule({ bus, config }));
  disposers.push(registerNotificationsModule({ bus, config }));
  disposers.push(
    registerPluginsModule({
      bus,
      config,
      plugins: options.plugins ?? [],
      logger: options.logger,
    }),
  );

  return {
    bus,
    shutdown() {
      while (disposers.length) {
        const dispose = disposers.pop();
        try {
          dispose?.();
        } catch (error) {
          options.logger?.error?.('Failed to dispose module handler', error);
        }
      }
    },
  };
}

export * from './auth/index.js';
export * from './scraping/index.js';
export * from './enrichment/index.js';
export * from './scoring/index.js';
export * from './notifications/index.js';
export * from './plugins/index.js';
