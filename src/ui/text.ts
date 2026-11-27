// src/ui/text.ts
// Т.7: граматика гравцевих текстів шару відображення (ADR-0037) — узгодження
// числівника з «тік» і роду дієслова з іменем оперативника. Чисті функції без
// DOM; ядро не зачіпається (тексти — відображення, ADR-0064).

// «1 тік», «3 тіки», «8 тіків», «21 тік» — замість «тік(и)»/«тик(и)»
// (глосарій: «тік»). Правило української: 1 → однина; 2–4 → «тіки»;
// решта і 11–14 → «тіків».
export function ticksText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' тік';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' тіки';
  return n + ' тіків';
}

// Рід за іменем: перше слово на «-а»/«-я» — жіночий («Олена», «Марія 2»).
// Правило точне для пулу імен ядра (SOLDIER_NAMES, squad.ts) — розбиття пулу
// зафіксовано тестом text.test.ts: нове ім'я змушує звірити правило.
// Решта назв юнітів («Демон Карх», п21.5: перше слово — тип) — чоловічий рід; п18.4 (аудит PR #515): «Турель N» — жіночий;
// «Око <ім'я>» — середній (isNeuterName нижче, п21.7).
export function isFeminineName(name: string): boolean {
  const first = name.split(' ')[0];
  return first.endsWith('а') || first.endsWith('я') || first === 'Турель';
}

// п21.7 (кандидат 213 а, рішення власника «Рід «Око»»): «Око <ім'я>» — середній рід.
export function isNeuterName(name: string): boolean {
  return name.split(' ')[0] === 'Око';
}

// Форма слова за родом імені: byGender('Олена', 'загинув', 'загинула').
// Середній рід (neut) — лише там, де його передано; без нього — чоловічий, як до п21.7.
export function byGender(name: string, masc: string, fem: string, neut: string = masc): string {
  if (isNeuterName(name)) return neut;
  return isFeminineName(name) ? fem : masc;
}

// T.39: «1 доба», «2 доби», «5 діб», «21 доба» — узгодження слова «доба» з
// числом (те саме українське правило, що й у ticksText для «тик»).
export function daysText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' доба';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' доби';
  return n + ' діб';
}

// T.39: число + іменник у відмінку: plural(2, 'техномант', 'техноманти', 'техномантів').
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' ' + one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' ' + few;
  return n + ' ' + many;
}

// Т.218 (рішення власника «probe / «зонд»»): номер зонда для тексту — «№3» з id `probe3` (старий сейв — `ufo3`
// на диску, у пам'яті теж `probe3`); id без номера — як є.
export function probeNo(id: string): string {
  const m = /\d+$/.exec(id);
  return m ? '№' + m[0] : id;
}
