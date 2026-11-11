// stryker.config.mjs — мутаційне тестування ядра (ADR-0083): `npm run test:mutation`.
// Мутуються правила гри в src/core; вбивають мутантів тести без DOM
// (vitest.stryker.config.ts). Звіт — dist/mutation/index.html.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.stryker.config.ts' },
  mutate: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    // Оркестратор симуляцій балансу: у гру не входить, перевіряється лише повними
    // партіями, яких у мутаційному прогоні немає (vitest.stryker.config.ts).
    '!src/core/party-bot.ts',
    // Матриці пікселів і палітра без логіки: мутант тут — зіпсований піксель.
    '!src/core/sprites.ts',
  ],
  coverageAnalysis: 'perTest',
  // Пісочниця — поза репозиторієм: vitest 5 виключає лише node_modules і .git,
  // тож копії тестів у теці проєкту потрапили б у звичайний `npm test`.
  tempDirName: join(tmpdir(), 'rubezh-stryker'),
  cleanTempDir: 'always',
  ignorePatterns: ['dist', 'docs', 'e2e', '.husky', '.github'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'dist/mutation/index.html' },
  jsonReporter: { fileName: 'dist/mutation/mutation.json' },
  clearTextReporter: { reportTests: false, reportMutants: false, reportScoreTable: true },
  thresholds: { high: 90, low: 75, break: null },
};
