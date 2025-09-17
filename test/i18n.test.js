import { beforeEach, describe, expect, it, vi } from 'vitest';

const MODULE_PATH = '../src/i18n.js';
const ES_LOCALE_PATH = '../src/locales/es.js';

describe('i18n translator', () => {
  beforeEach(() => {
    vi.resetModules();
    if (typeof vi.doUnmock === 'function') vi.doUnmock(ES_LOCALE_PATH);
  });

  it('falls back to the default locale when locale is unknown', async () => {
    const { t } = await import(MODULE_PATH);
    expect(t('company', 'fr')).toBe('Company');
  });

  it('falls back when requested locale lacks a translation', async () => {
    vi.doMock(ES_LOCALE_PATH, () => ({
      default: {
        location: 'Ubicación',
      },
    }));

    const { t } = await import(MODULE_PATH);
    expect(t('company', 'es')).toBe('Company');
  });

  it('returns the key when translation missing in all locales', async () => {
    const { t } = await import(MODULE_PATH);
    expect(t('nonexistent.key', 'fr')).toBe('nonexistent.key');
  });
});
