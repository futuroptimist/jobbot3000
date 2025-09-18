import { describe, it, expect } from 'vitest';
import { t, DEFAULT_LOCALE } from '../src/i18n.js';

describe('i18n', () => {
  it('returns English translations by default', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(t('company')).toBe('Company');
  });

  it('uses locale specific translations when available', () => {
    expect(t('company', 'es')).toBe('Empresa');
    expect(t('company', 'fr')).toBe('Entreprise');
  });

  it('falls back to the default locale for unknown locales', () => {
    expect(t('company', 'pt')).toBe('Company');
  });

  it('falls back to the key when missing in every locale', () => {
    expect(t('unknownKey')).toBe('unknownKey');
  });

  it('interpolates replacements in translation strings', () => {
    expect(t('greeting', 'es', { name: 'María' })).toBe('¡Hola, María!');
    expect(t('greeting', 'fr', { name: 'Alex' })).toBe('Bonjour, Alex!');
  });

  it('preserves placeholders without replacements', () => {
    expect(t('greeting', 'fr')).toBe('Bonjour, {name}!');
    expect(t('greeting', 'en', { missing: 'value' })).toBe('Hello, {name}!');
  });

  it('uses default locale template when falling back and still interpolates', () => {
    expect(t('greeting', 'pt', { name: 'Taylor' })).toBe('Hello, Taylor!');
  });
});
