// playwright.config.ts
// Домен-смок прев'ю (ADR-0063): єдиний chromium-проєкт, мінімальний час рана.
// Ціль — env SMOKE_URL (прев'ю гілки у CI; без env — локальний статичний
// сервер на порту 8000).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // testMatch *.e2e.ts: суфікс e2e не потрапляє у глоб vitest (**/*.{test,spec}.ts)
  // — юніт-прогін (npm test, test:coverage) спеку смоку не тягне.
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,
  retries: 2,
  use: {
    baseURL: process.env.SMOKE_URL ?? 'http://localhost:8000/rubezh/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
