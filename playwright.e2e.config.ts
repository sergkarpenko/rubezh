// playwright.e2e.config.ts
// Сценарій приймання (ADR-0080): прохід гри в браузері проти збірки ТОГО Ж
// коміту — код сценарію, дзеркало ядра і гра завжди з одного дерева файлів.
// Окремий конфіг від домен-смоку прев'ю (playwright.config.ts, ADR-0063): той
// виконується з main проти задеплоєного прев'ю чужої гілки і сценарію не тягне
// (testMatch *.scenario.ts проти *.e2e.ts).
// Ціль — локальний `vite preview` зібраного dist (піднімає сам Playwright);
// env E2E_URL — уже запущений сервер тієї ж збірки (тоді webServer не стартує).
// env E2E_CHROME — шлях до системного Chrome, якщо браузер Playwright не
// встановлено (хмарні сесії агентів без доступу до CDN Playwright).
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const externalUrl = process.env.E2E_URL;
const chromePath = process.env.E2E_CHROME;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.scenario\.ts/,
  // dist/ вже в .gitignore: трейси і звіти не засмічують робоче дерево
  outputDir: './dist/e2e-results',
  fullyParallel: false,
  // Сценарій детермінований (ADR-0003): ретрай лише сховав би нестабільність
  retries: 0,
  // назви кроків сценарію в журналі: видно, на якому кроці впав прохід
  reporter: [['list', { printSteps: true }]],
  timeout: 240_000,
  use: {
    baseURL: externalUrl ?? `http://localhost:${PORT}/rubezh/`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  webServer: externalUrl
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/rubezh/`,
        // чужий сервер на порту міг би віддавати стару збірку — лише свій, свіжий
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
