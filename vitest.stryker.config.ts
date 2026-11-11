// vitest.stryker.config.ts — конфіг vitest лише для мутаційного прогону (ADR-0083).
// Звичайний `npm test` цього файлу не читає — він бере vite.config.ts.
import { mergeConfig } from 'vitest/config';
import base from './vite.config';

export default mergeConfig(base, {
  test: {
    // Інструментований код (усі мутанти в одному файлі + облік покриття на кожен
    // тест) у кілька разів повільніший за звичайний: стандартних 5 с не вистачає.
    testTimeout: 120_000,
    // Мутантів ядра вбивають тести без DOM: тести ядра, інтеграційний цикл і тести
    // рендера на мок-контекстах (вони перевіряють render-core.ts).
    // DOM-тести (jsdom) сюди не входять: середовище коштує часу на кожному мутанті.
    include: ['src/core/**/*.test.ts', 'src/cycle.test.ts', 'src/render.*.test.ts'],
    // Повні партії party-bot (30 діб) покривають майже все ядро: з ними кожен
    // мутант коштує секунди, а прогін — близько чотирьох годин замість години.
    exclude: ['src/core/party-bot.test.ts'],
  },
});
