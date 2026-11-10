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
  {
    // ADR-0079: правила ядра з AGENTS.md — у лінті, а не в увазі агента.
    // Діють і на тести ядра: тести — на фіксованому RNG і фіксованих мітках часу.
    // «Ядро без DOM» (ADR-0002) перевіряє компіляція: tsconfig.core.json без lib.dom.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'ADR-0003: у ядрі випадковість — лише через ін’єктований RNG (mulberry32), не Math.random().',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'ADR-0003: ядро не читає годинник — час приходить аргументом (той самий сід + дії = той самий результат).',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'ADR-0003: ядро не читає годинник — час приходить аргументом.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'ADR-0003: new Date() без аргументів читає годинник — у ядрі заборонено; мітку часу передає шар відображення.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: 'ADR-0002/0038: ядро не імпортує нічого поза src/core (шар відображення залежить від ядра, не навпаки).',
            },
          ],
        },
      ],
    },
  }
);
