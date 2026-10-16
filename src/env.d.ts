// П10.2 (Фаза 10): глобальна константа версії гри — інжектиться на зборці
// vite define з package.json (одиничне джерело числа, урок П9.1). Декларація
// для TypeScript; значення живе у vite.config.ts, не тут.
declare const __APP_VERSION__: string;
