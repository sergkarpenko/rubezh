// ESLint 9+ flat config — П10, ADR-0015
// Суворі типи: жодних any (AGENTS.md)
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'docs/prototypes/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error', // AGENTS.md: суворі типи
    },
  },
);
