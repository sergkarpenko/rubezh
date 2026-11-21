// Гейт ADR-0107 / ADR-0108 (Т.108): типів Node у програмі `tsconfig.json` (`src`) немає.
// Кожен рядок нижче — помилка «Cannot find name», яку гасить `@ts-expect-error`.
// Якщо глобали Node повернуться в `src` будь-яким шляхом — `/// <reference types="node" />`,
// `import type … from 'vite'` чи інший пакет із типами Node, — помилки зникнуть, директива
// стане невикористаною (TS2578) і `npx tsc --noEmit` у CI почервоніє.
// Файл лише з типами: у збірку і мутаційний прогін не потрапляє; typedoc його не документує,
// але перевіряє типи — витік червонить і `npm run docs`.

// @ts-expect-error — глобала `process` у `src` немає (ADR-0107)
export type NodeProcessGuard = typeof process;
// @ts-expect-error — глобала `Buffer` у `src` немає (ADR-0107)
export type NodeBufferGuard = typeof Buffer;
// @ts-expect-error — простору імен `NodeJS` у `src` немає (ADR-0107)
export type NodeNamespaceGuard = NodeJS.Timeout;
