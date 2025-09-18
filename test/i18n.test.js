import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  try {
    vi.doUnmock('../src/locales/es.js');
  } catch {
    // ignore when module was not mocked
  }
});

describe('t', () => {
  it('returns default locale translations when locale omitted', async () => {
    vi.resetModules();
    const { t, DEFAULT_LOCALE } = await import('../src/i18n.js');
    expect(DEFAULT_LOCALE).toBe('en');
    expect(t('company')).toBe('Company');
  });

  it('returns translations for supported locales', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('company', 'es')).toBe('Empresa');
    expect(t('company', 'fr')).toBe('Entreprise');
  });

  it('falls back to default locale when locale missing', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('company', 'pt')).toBe('Company');
  });

  it('falls back to default translation when key missing in locale', async () => {
    vi.resetModules();
    vi.doMock('../src/locales/es.js', () => ({
      default: {
        summary: 'Resumen',
      },
    }));
    const { t } = await import('../src/i18n.js');
    expect(t('company', 'es')).toBe('Company');
  });

  it('returns key when translation missing in all locales', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('nonexistent_key')).toBe('nonexistent_key');
  });

  it('interpolates replacements in translation strings', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('greeting', 'es', { name: 'María' })).toBe('¡Hola, María!');
    expect(t('greeting', 'fr', { name: 'Alex' })).toBe('Bonjour, Alex!');
  });

  it('preserves placeholders without replacements', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('greeting', 'fr')).toBe('Bonjour, {name}!');
    expect(t('greeting', 'en', { missing: 'value' })).toBe('Hello, {name}!');
  });

  it('uses default locale template when falling back and still interpolates', async () => {
    vi.resetModules();
    const { t } = await import('../src/i18n.js');
    expect(t('greeting', 'pt', { name: 'Taylor' })).toBe('Hello, Taylor!');
  });
});
