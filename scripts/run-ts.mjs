// scripts/run-ts.mjs — запуск скриптів scripts/*.ts (probe, симуляції) без
// окремої залежності (Т.103): модуль іде через `runnerImport` з `vite`, що вже
// в devDependencies (Vite 8 — module runner). Замінює `npx -y vite-node`,
// який щоразу завантажував пакет: vite-node у дереві залежностей більше немає.
//   node scripts/run-ts.mjs scripts/sim-p11.8.ts --seeds 5
//   node scripts/run-ts.mjs scripts/probe-t23.ts -- --variants none --seeds 10
// Аргументи після шляху до скрипта лишаються в process.argv як є (скрипти
// шукають прапорці через indexOf, тож «--» не заважає). Корінь Vite — клон,
// у якому лежить цей файл; тека запуску (cwd) лишається текою виводу, тож
// прогін з іншої теки (`cd <тека> && node <клон>/scripts/run-ts.mjs …`) пише
// dist/ у неї, як раніше `vite-node --root <клон>`.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const file = process.argv[2];
if (!file || !file.endsWith('.ts')) {
  console.error('Використання: node scripts/run-ts.mjs <скрипт.ts> [аргументи…]');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await runnerImport(resolve(file), { root, configFile: false, logLevel: 'error' });
