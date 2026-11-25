// scripts/launch-chrome.ts — браузер скриптів вимірів і стенда (Т.175, кандидат процесу 160):
// той самий шрифт, що й у e2e (ADR-0139) — Chromium отримує e2e/fonts.conf через FONTCONFIG_FILE,
// тож `system-ui` і `sans-serif` = DejaVu Sans. `inter: true` — без конфіга: шрифт системи
// (у контейнері сесії — Inter; варіант, де ширшає текст, міряють з обома, docs/agents/common.md).
// Конфіг — лише для Linux (fontconfig); шлях до Chrome — env E2E_CHROME, як у playwright.e2e.config.ts.
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

// колишній прапорець dj скриптів вимірів: DejaVu тепер типово — попередження в stderr (аудит PR #489)
export const warnDj = (args: string[]): void => {
  if (args.includes('dj')) console.error('dj: з Т.175 DejaVu Sans — типово; для Inter — прапорець inter');
};

export const FONTS_CONF = fileURLToPath(new URL('../e2e/fonts.conf', import.meta.url));

// `inter`: FONTCONFIG_FILE з оточення запуску прибирається — інакше «без конфіга» взяв би чужий (аудит Vibe PR #489)
export const launchChrome = (opts: { inter?: boolean } = {}): Promise<Browser> => {
  const rest = { ...process.env };
  delete rest.FONTCONFIG_FILE;
  return chromium.launch({ executablePath: process.env.E2E_CHROME, env: opts.inter ? rest : { ...rest, FONTCONFIG_FILE: FONTS_CONF } });
};
