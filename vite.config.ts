// vite.config.ts
// База GitHub Pages: сайт живе за шляхом /rubezh/.
// П10.2 (Фаза 10): версія гри — єдине джерело package.json; на зборці (і в
// тестах) пробрасжується глобальною константою __APP_VERSION__ (vite define),
// щоб число не дублювалось у текстах (урок П9.1).
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  base: '/rubezh/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
