// Т.30: конфіг проходу зі знімками (docs/reports/t30/shots.scenario.ts) — три розміри вікна.
// Збірку піднімати окремо: npm run build && npx vite preview --port 4173 --strictPort.
import { defineConfig } from '@playwright/test';

const chromePath = process.env.E2E_CHROME;

export default defineConfig({
  testDir: '.',
  testMatch: /shots\.scenario\.ts/,
  outputDir: '../../../dist/t30-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list', { printSteps: false }]],
  timeout: 600_000,
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:4173/rubezh/',
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  projects: [
    { name: 'd1366', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
    { name: 'd1920', use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } } },
    { name: 'ipad', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 }, hasTouch: true } },
  ],
});
