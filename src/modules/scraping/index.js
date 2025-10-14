import { fetchAshbyJobs } from './providers/ashby.js';
import { fetchGreenhouseJobs } from './providers/greenhouse.js';
import { fetchLeverJobs } from './providers/lever.js';
import { fetchSmartRecruitersJobs } from './providers/smartrecruiters.js';
import { fetchWorkableJobs } from './providers/workable.js';

const PROVIDERS = {
  ashby: fetchAshbyJobs,
  greenhouse: fetchGreenhouseJobs,
  lever: fetchLeverJobs,
  smartrecruiters: fetchSmartRecruitersJobs,
  workable: fetchWorkableJobs,
};

function resolveProvider(overrides, provider) {
  if (overrides?.[provider]) {
    return overrides[provider];
  }
  return PROVIDERS[provider];
}

export function registerScrapingModule({ bus, config } = {}) {
  if (!bus || typeof bus.registerHandler !== 'function') {
    throw new Error('registerScrapingModule requires a module event bus');
  }

  const overrides = config?.overrides?.scrapingProviders ?? {};
  const useMocks = config?.features?.scraping?.useMocks === true;
  const mockHandler = config?.mocks?.scrapingProvider;

  const handlers = [
    bus.registerHandler('scraping:providers:list', async () => Object.keys(PROVIDERS)),
    bus.registerHandler('scraping:jobs:fetch', async payload => {
      const { provider, options } = payload || {};
      if (!provider || typeof provider !== 'string') {
        throw new Error('scraping:jobs:fetch requires a provider');
      }
      const normalized = provider.toLowerCase();
      const handler = resolveProvider(overrides, normalized);
      if (!handler) {
        throw new Error(`Unsupported scraping provider: ${normalized}`);
      }
      if (useMocks && typeof mockHandler === 'function') {
        return mockHandler({ provider: normalized, options });
      }
      return handler(options || {});
    }),
  ];

  return () => handlers.splice(0).forEach(dispose => dispose?.());
}

export function getScrapingProviders() {
  return { ...PROVIDERS };
}
