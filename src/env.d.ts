/// <reference types="vite/client" />
// П10.2 (Фаза 10): глобальна константа версії гри — інжектиться на зборці
// vite define з package.json (одиничне джерело числа, урок П9.1). Декларація
// для TypeScript; значення живе у vite.config.ts, не тут.
declare const __APP_VERSION__: string;

// П13.4 (ADR-0068/0071): імпорти ассетів відображення (assets/logo.webp тощо)
// — vite на зборці перетворює їх на URL. Типи модулів ассетів (*.webp, *.png
// та ін.) дає стандартна декларація vite/client (референс у першому рядку —
// директива діє лише на початку файла); власні `declare module` прибрано
// (Т.5a): разом із тим самим референсом у main.ui.test.ts вони давали TS2300
// «Duplicate identifier» у повному `tsc --noEmit`.
