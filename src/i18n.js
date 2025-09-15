import en from './locales/en.js';
import es from './locales/es.js';

/**
 * Simple dictionary-based translator.
 * Falls back to English when a key or locale is missing.
 */

export const DEFAULT_LOCALE = 'en';

const TRANSLATIONS = { en, es };

export function t(key, locale = DEFAULT_LOCALE) {
  const lang = TRANSLATIONS[locale] || TRANSLATIONS[DEFAULT_LOCALE];
  return lang[key] || TRANSLATIONS[DEFAULT_LOCALE][key] || key;
}
