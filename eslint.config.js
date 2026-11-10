import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// The UI framework must stay swappable: React may only be imported from src/ui.
const frameworkImports = {
  patterns: [
    { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: 'React is allowed only in src/ui.' },
    { group: ['**/ui/**', '**/ui'], message: 'core/engine must not depend on the UI layer.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          ...frameworkImports.patterns,
          { group: ['konva', 'konva/*', 'dexie', '**/engine/**', '**/engine'], message: 'core is pure TypeScript: no DOM/engine dependencies.' },
        ],
      }],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', frameworkImports] },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
