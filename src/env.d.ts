// П10.2 (Фаза 10): глобальна константа версії гри — інжектиться на зборці
// vite define з package.json (одиничне джерело числа, урок П9.1). Декларація
// для TypeScript; значення живе у vite.config.ts, не тут.
declare const __APP_VERSION__: string;

// П13.4 (ADR-0068): PNG-імпорт ассета лого (assets/logo.png) — vite на зборці
// перетворює його на base-аварійний URL; для перевірки типів (npm run docs)
// декларуємо тип модуля (вітест значення не використовує — фолбек-гілка).
declare module '*.png' {
  const url: string;
  export default url;
}
