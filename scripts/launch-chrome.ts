// scripts/launch-chrome.ts — браузер скриптів вимірів і стенда (Т.175, кандидат процесу 160):
// той самий шрифт, що й у e2e (ADR-0139) — Chromium отримує e2e/fonts.conf через FONTCONFIG_FILE,
// тож `system-ui` і `sans-serif` = DejaVu Sans. `inter: true` — без конфіга: шрифт системи
// (у контейнері сесії — Inter; варіант, де ширшає текст, міряють з обома, docs/agents/common.md).
// Конфіг — лише для Linux (fontconfig); шлях до Chrome — env E2E_CHROME, як у playwright.e2e.config.ts.
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

export const FONTS_CONF = fileURLToPath(new URL('../e2e/fonts.conf', import.meta.url));

export const launchChrome = (opts: { inter?: boolean } = {}): Promise<Browser> =>
  chromium.launch({
    executablePath: process.env.E2E_CHROME,
    ...(opts.inter ? {} : { env: { ...process.env, FONTCONFIG_FILE: FONTS_CONF } }),
  });
