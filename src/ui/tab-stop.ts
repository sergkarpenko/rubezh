// Т.218: пастка фокусу вікон (src/main.ts) — які елементи є зупинками Tab.
// Т.218: Tab-зупинка, як у браузері: поле в закритому `details` — ні (його `summary` — так);
// з радіогрупи — лише обрана кнопка (Tab бере групу однією зупинкою, стрілки — всередині).
export function tabStop(e: HTMLElement): boolean {
  if (e.tagName !== 'SUMMARY' && e.closest('details:not([open])') !== null) return false;
  if (e instanceof HTMLInputElement && e.type === 'radio') return e.checked;
  return true;
}
