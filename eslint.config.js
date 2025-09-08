import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'max-len': ['error', { code: 100 }],
    },
  },
];
