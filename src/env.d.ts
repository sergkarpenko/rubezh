// П10.2 (Фаза 10): глобальна константа версії гри — інжектиться на зборці
// vite define з package.json (одиничне джерело числа, урок П9.1). Декларація
// для TypeScript; значення живе у vite.config.ts, не тут.
declare const __APP_VERSION__: string;

// П13.4 (ADR-0068/0071): імпорти ассетів відображення (assets/logo.webp тощо)
// — vite на зборці перетворює їх на base-аварійний URL; для перевірки типів
// (npm run docs) декларуємо типи модулів (вітест значення не використовує —
// фолбек-гілка). Формати — за доцільністю (ADR-0071).
declare module '*.webp' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
