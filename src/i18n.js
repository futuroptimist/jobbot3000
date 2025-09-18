import en from './locales/en.js';
import es from './locales/es.js';
import fr from './locales/fr.js';

/**
 * Simple dictionary-based translator.
 * Falls back to English when a key or locale is missing.
 */

export const DEFAULT_LOCALE = 'en';

const TRANSLATIONS = { en, es, fr };

export function t(key, locale = DEFAULT_LOCALE, replacements) {
  const lang = TRANSLATIONS[locale] || TRANSLATIONS[DEFAULT_LOCALE];
  const template = lang[key] || TRANSLATIONS[DEFAULT_LOCALE][key] || key;

  if (!replacements || typeof template !== 'string') return template;

  return template.replace(/\{(\w+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(replacements, token)) {
      const value = replacements[token];
      return value == null ? '' : String(value);
    }
    return match;
  });
}
