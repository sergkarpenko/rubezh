# Т.69 — рядок #fighter-last лишається після програної місії: план для Vibe Code

**Хто що робить (рішення власника 18.11.2026).** План підготувала хмарна сесія Claude (Fable 5.2). Тест, звіт, запис кроку і PR робить агент **Mistral Vibe Code**. Знахідки аудиту виправляє Vibe Code у тій самій сесії. Мерж — агент-планувальник після аудиту, клас `auto`; **виконавець PR не мержить**.

**Джерело:** кандидат 71 — перший крок Vibe за шаблоном плану Т.67; зміст — кандидат 55 (після Т.66): рядок `#fighter-last` після перерваного перехоплення показується, поки зонд події ще в `geo.ufos` (`probeGone` у `src/ui/panels.ts`, Т.51). Тест Т.66 на сторінці тримає виграну місію (зонда вже немає — рядка немає); що після програної місії зонд лишається (`completeMission` у `src/core/mission.ts`) і рядок лишається, на сторінці не тримав жоден тест. Не міняється нічого, крім тестів і документів: `src/` (крім `src/main.ui.test.ts`), `index.html`, `e2e/`, `.github/`, `package.json`.

**Перед роботою прочитати:** `AGENTS.md`, `docs/agents/common.md`, `docs/agents/ui.md` (розділи «Лише для хмарної сесії Claude» пропустити; розділ «Лише для Mistral Vibe Code» у `docs/agents/common.md` — прочитати). Записи Т.51 і Т.66: `grep -n 'Т.51\|Т.66' docs/workflow.md | cut -c1-200`.

**Готові блоки.** Усі нові рядки цього плану — блоки з позначкою `<!-- блок: ім'я -->`. Руками їх не набирати: спершу `node scripts/vibe-plan-blocks.mjs docs/plans/t69-fighter-last-lost.md /tmp/blocks`, далі брати вміст із `/tmp/blocks/<ім'я>.txt`. Вставку і заміну робити скриптом `python3` поза репозиторієм (`/tmp`), з `assert s.count(якір) == 1` на кожну. Текст поза блоками — вказівки: у код, документи й опис PR його не переносити.

## Терміни гри (писати саме так)

Вивід інструментів у середовищі виконавця екранує кирилицю, тому слова легко переплутати. Файли з кирилицею читати через `python3`. У коді, тестах і документах:

- **зонд** (не «зона»), **сід** (не «сид», не «seed» у тексті), **тік** (на 21-му тіку), **перехоплювач** (не «перехоплюач»);
- **немає** (не «не має»): «розбіжностей немає», «рядка немає»; слова «немає» і «нічого» в документи ставить скрипт `docs-py` — руками їх у місця не вписувати;
- **наскрізний тест на сторінці** — тест vitest у `src/main.ui.test.ts`, що клікає сторінку в jsdom; це не сценарій e2e (`npm run test:e2e`, Playwright, тека `e2e/`);
- **програна місія** — картка результату «ЗАГІН ВТРАЧЕНО»; **евакуйована місія** — картка «ЗАГІН ЕВАКУЙОВАНО»; повний словник — `docs/glossary.md`.

Назви змінних і функцій — від цих слів (`probeGone`, а не `zoneGone`).

## Відповідь власника (18.11.2026, до реалізації)

Дослівного тексту питання в документі стану немає. Відповідь: **«71: Vibe за шаблоном Т.67 (Рекомендовано)»**.

У звіті, записі кроку й описі PR рішення власника цитувати **лише з цього розділу, дослівно**. Іншого власник не казав: нових цитат не складати, слова не переставляти. Сценарій тесту (сід 36, пресет «складний», місія одразу після переривання, поразка авто-боєм), набір навмисних поломок і те, що евакуйована місія в цей крок не входить (межа (а) розділу 5), — рішення планувальника.

## Що зробити

### 1. Код

Немає: `src/` (крім `src/main.ui.test.ts`) і `index.html` не змінюються.

### 2. Тест модуля

Немає: тести модулів не змінюються.

### 3. Наскрізний тест на сторінці: `src/main.ui.test.ts`

Новий блок `describe('Т.69: …', …)` — у самому кінці файла, після блоку Т.66 (блоки тримають спільний стан — у чужі не вставляти). Як він працює (перевірено по коду на `main` = `61c3689`):

- сід 36, пресет «складний»: зонд ufo1 виявлено, перехоплювач стартує, зонд приземляється під час погоні — журнал і `#fighter-last` пишуть «✦ Зонд Розриву ufo1 приземлився — перехоплення перервано»;
- одразу, без жодного тіку, тест запускає місію на ufo1 і доводить її авто-боєм до поразки («ЗАГІН ВТРАЧЕНО»): `completeMission` зонд у `geo.ufos` лишає (`src/core/mission.ts`);
- на картці результату і після «← Повернутись на геосцену» (`btn-close`) рядок `#fighter-last` той самий і один, зонд у списку, кнопка місії є.

Блок тестів — **дослівно, кодом нижче** (перевірено планувальником на прототипі: зелений на `main`, червоний на поломках розділу 4). Вставити його без змін скриптом — блок `insert-py`: скопіювати `/tmp/blocks/insert-py.txt` у `/tmp/t69/insert.py` і запустити з кореня репозиторію (`python3 /tmp/t69/insert.py`); потім `npx vitest run src/main.ui.test.ts -t 'Т.69'` — 1 тест зелений. Якщо блок не проходить — не переписувати, а написати в сесії, що саме падає.

<!-- блок: test-t69 -->
```ts
// Т.69 (кандидат 55, після Т.66; план — docs/plans/t69-fighter-last-lost.md): рядок #fighter-last
// після перерваного перехоплення (зонд приземлився) лишається, коли місію на цьому зонді програно, — зонд
// лишається в geo.ufos (completeMission). Виграну місію тримає тест Т.66; евакуйованої зі сторінки не досягти.
describe('Т.69: рядок #fighter-last лишається після програної місії', () => {
  it('Т.69: сід 36, пресет «складний»: перехоплення ufo1 перервано приземленням, місію на ufo1 програно — рядок лишається', async () => {
    startParty('36', 'складний');
    // 1. тикаємо, доки не з'явиться активна кнопка перехоплення (запобіжник — 60 кліків), і клікаємо її
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) {
      const b = [...document.querySelectorAll<HTMLButtonElement>('button.intercept')].find((x) => !x.disabled);
      if (b) {
        b.click();
        launched = true;
      } else btn('btn-tick').click();
    }
    expect(launched).toBe(true);
    // 2. тикаємо, доки не з'явиться #fighter-last (запобіжник — 10 кліків): зонд приземлився під час погоні
    for (let i = 0; i < 10 && document.getElementById('fighter-last') === null; i++) btn('btn-tick').click();
    const abortedText = '✦ Зонд Розриву ufo1 приземлився — перехоплення перервано';
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 3. місія на ufo1 — одразу, без жодного тіку
    const mission = document.querySelector<HTMLButtonElement>('#ufos .ufo button.mission');
    expect(mission).not.toBeNull();
    expect(mission!.disabled).toBe(false);
    mission!.click();
    expect($('battle-panel').classList.contains('hidden')).toBe(false);
    // 4. авто-бій до результату — поразка (сід 36, пресет «складний»)
    await runAutoBattle();
    expect($('bresult').textContent).toContain('ЗАГІН ВТРАЧЕНО');
    // 5. уже на картці результату (finish перемальовує панелі): зонд лишився в списку, рядок на панелі — той самий, один
    expect(document.querySelectorAll('#ufos .ufo')).toHaveLength(1);
    expect(document.querySelectorAll('#fighter-last')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
    // 6. назад на геосцену: зонд у списку, місію можна повторити, рядок на панелі лишився
    btn('btn-close').click();
    expect($('geo-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#ufos .ufo button.mission')).toHaveLength(1);
    expect(document.getElementById('fighter-last')?.textContent).toBe(abortedText);
  });
});
```

<!-- блок: insert-py -->
```python
# Т.69: вставка блоку тестів у кінець src/main.ui.test.ts. Запуск з кореня репозиторію: python3 /tmp/t69/insert.py
p = 'src/main.ui.test.ts'
block = open('/tmp/blocks/test-t69.txt', encoding='utf-8').read()
s = open(p, encoding='utf-8').read()
assert s.count("describe('Т.69") == 0
assert s.count("describe('Т.66: рядок #fighter-last зникає після виграної місії'") == 1
assert s.endswith('});\n')
open(p, 'w', encoding='utf-8').write(s + '\n' + block + '\n')
print('вставлено')
```

Коміт тесту — назвою з блоку `commit-test`: `git add src/main.ui.test.ts && git commit -F /tmp/blocks/commit-test.txt`.

<!-- блок: commit-test -->
```text
test(ui): Т.69 — рядок #fighter-last лишається після програної місії
```

### 4. Навмисні поломки (до PR, результати — у звіт)

Тест спершу закомітити (назвою з блоку `commit-test`). Поломки робить скрипт — блок `mutations-py`: скопіювати `/tmp/blocks/mutations-py.txt` у `/tmp/t69/mutations.py` (поза репозиторієм) і запустити з кореня репозиторію (`python3 /tmp/t69/mutations.py`, ≈ 7 хв; якщо команда обривається за часом — запустити її у фоні з виводом у файл `/tmp/t69/mutations.log` і читати файл). Скрипт спершу проганяє тести на чистому коді (усі мають бути зелені), далі по одній робить поломку, проганяє новий тест «Т.69» окремим процесом (`-t`) і наявні тести файлом `src/main.ui.test.ts` цілком, повертає файл, пише таблицю у `/tmp/t69/table.md` і підсумок реченням у `/tmp/t69/summary.md` — у звіт, запис кроку й опис PR вони йдуть цими файлами, без правок руками (розділ 5). Після прогону `git status --short` порожній.

Поломки «таймер знято, стан лишився» немає: крок не про зупинку авто-бою, анімації чи таймера.

Що побачив планувальник на прототипі (після останньої правки прототипу, повний вивід прогону):

<!-- блок: table-plan -->
```text
| № | Поломка | Т.69 (окремо) | Т.66 на сторінці |
| --- | --- | --- | --- |
| 1 | `probeGone` не дивиться на `geo.ufos` (завжди «зонда немає») | червоний | червоний |
| 2 | `probeGone` вважає зонд зниклим після програної місії (подія `mission_lost` у журналі) | червоний | зелений |
| 3 | `completeMission` після поразки прибирає зонд з `geo.ufos` | червоний | зелений |
| 4 | рядок `#fighter-last` на панелі двічі | червоний | зелений |
| 5 | змінити слово в тексті UI в `src/ui/journal.ts` («приземлився» → «сів») | червоний | червоний |
| 6 | змінити слово на картці результату в `src/ui/battle.ts` («ВТРАЧЕНО» → «ЗНИЩЕНО») | червоний | зелений |
| 7 | після програної місії кнопки місії на зонді немає | червоний | зелений |
| 8 | текст рядка `#fighter-last` після програної місії інший | червоний | зелений |
| 9 | закриття бою після поразки прибирає з журналу геосцени подію про переривання | червоний | зелений |
| 10 | закриття бою після поразки пише в журнал геосцени новий старт перехоплення | червоний | зелений |
```

Підсумок, який надрукував скрипт на прототипі: «Навмисних поломок — 10; хоча б один новий тест ловить 10 з 10.». Перевірки `expect` без поломки на прототипі (файл `expects.md`): п'ять рядків переліку — кроки сценарію (перехоплення стартувало; кнопка місії є; кнопка місії активна; бій відкрився; геосцена відкрилась) — лишено; перевірок результату без поломки немає. Перевірку «рядок про переривання лишився в журналі» з прототипу прибрано: поломки, на якій тест падав би саме на ній, планувальник не знайшов, а журнал після місії тримає тест Т.66.

Розбіжність із таблицею плану виконавець не пояснює і не домислює: розбіжні рядки назве `docs-py`.

<!-- блок: mutations-py -->
```python
# Т.69: навмисні поломки — по одній; кожен новий тест «Т.69» — окремим прогоном (-t), наявні тести — прогоном
# файлів цілком; повернення файла; таблиця — у /tmp/t69/table.md, підсумок реченням — у /tmp/t69/summary.md;
# перевірки expect нових тестів, на яких жодна поломка не впала, — у /tmp/t69/expects.md (для планувальника).
# Запуск з кореня репозиторію: python3 /tmp/t69/mutations.py
import json, os, re, subprocess

TMP = '/tmp/t69'
NEW_FILE = 'src/main.ui.test.ts'
BLOCK = '/tmp/blocks/test-t69.txt'  # вставлений у NEW_FILE дослівно: за ним скрипт знає рядки нових тестів
FILES = ['src/main.ui.test.ts']
ALONE = [  # нові тести кроку: кожен окремим процесом — видно, що ловить саме він (Т.64, знахідка 10)
    ('Т.69 (окремо)', 'Т.69: сід 36, пресет «складний»: перехоплення ufo1 перервано приземленням, місію на ufo1 програно — рядок лишається'),
]
WHOLE = [  # наявні тести — прогоном файлів цілком
    ('Т.66 на сторінці', 'Т.66: сід 42, пресет «норма»: перехоплення ufo1 перервано приземленням, місію на ufo1 виграно — рядка немає'),
]
PANELS, MISSION, JOURNAL, BATTLE = 'src/ui/panels.ts', 'src/core/mission.ts', 'src/ui/journal.ts', 'src/ui/battle.ts'
GONE = '      !party.geo.ufos.some((u) => u.id === last.ufoId);'
MUTATIONS = [  # (поломка словами, файл, якір дослівно — рівно один у файлі, заміна)
    ('`probeGone` не дивиться на `geo.ufos` (завжди «зонда немає»)', PANELS, GONE, '      true;'),
    (
        '`probeGone` вважає зонд зниклим після програної місії (подія `mission_lost` у журналі)',
        PANELS,
        GONE,
        "      (!party.geo.ufos.some((u) => u.id === last.ufoId) || log.some((e) => e.type === 'mission_lost' && e.ufoId === last.ufoId));",
    ),
    (
        '`completeMission` після поразки прибирає зонд з `geo.ufos`',
        MISSION,
        "    geo.log.push({ type: 'mission_lost', ufoId, minute: geo.minute });",
        "    geo.ufos = geo.ufos.filter((u) => u.id !== ufoId);\n    geo.log.push({ type: 'mission_lost', ufoId, minute: geo.minute });",
    ),
    (
        'рядок `#fighter-last` на панелі двічі',
        PANELS,
        "      note.textContent = geoEventText(last, new Set())?.text ?? '';\n      box.appendChild(note);",
        "      note.textContent = geoEventText(last, new Set())?.text ?? '';\n      box.appendChild(note);\n      box.appendChild(note.cloneNode(true));",
    ),
    ('змінити слово в тексті UI в `src/ui/journal.ts` («приземлився» → «сів»)', JOURNAL, "' приземлився — перехоплення перервано'", "' сів — перехоплення перервано'"),
    ('змінити слово на картці результату в `src/ui/battle.ts` («ВТРАЧЕНО» → «ЗНИЩЕНО»)', BATTLE, 'ЗАГІН ВТРАЧЕНО ✗', 'ЗАГІН ЗНИЩЕНО ✗'),
    (
        'після програної місії кнопки місії на зонді немає',
        PANELS,
        "      if (targets.has(u.id)) {\n        const btn = document.createElement('button');\n        btn.className = 'mission';",
        "      if (targets.has(u.id) && !party.geo.log.some((e) => e.type === 'mission_lost' && e.ufoId === u.id)) {\n        const btn = document.createElement('button');\n        btn.className = 'mission';",
    ),
    (
        'текст рядка `#fighter-last` після програної місії інший',
        PANELS,
        "      note.textContent = geoEventText(last, new Set())?.text ?? '';\n      box.appendChild(note);",
        "      note.textContent = (geoEventText(last, new Set())?.text ?? '') + (log.some((e) => e.type === 'mission_lost') ? ' (місію програно)' : '');\n      box.appendChild(note);",
    ),
    (
        'закриття бою після поразки прибирає з журналу геосцени подію про переривання',
        BATTLE,
        "    ui.mission = null;\n    ui.battleResult = null;",
        "    if (ui.battleResult === 'поразка') deps.getParty().geo.log = deps.getParty().geo.log.filter((e) => e.type !== 'intercept_aborted');\n    ui.mission = null;\n    ui.battleResult = null;",
    ),
    (
        'закриття бою після поразки пише в журнал геосцени новий старт перехоплення',
        BATTLE,
        "    ui.mission = null;\n    ui.battleResult = null;",
        "    if (ui.battleResult === 'поразка') deps.getParty().geo.log.push({ type: 'intercept_start', ufoId: 'ufo1', minute: deps.getParty().geo.minute });\n    ui.mission = null;\n    ui.battleResult = null;",
    ),
]

def statuses(extra):
    out = TMP + '/vitest.json'
    if os.path.exists(out):
        os.remove(out)
    subprocess.run(['npx', 'vitest', 'run', *extra, '--reporter=json', '--outputFile=' + out], capture_output=True, text=True)
    with open(out, encoding='utf-8') as f:
        data = json.load(f)
    return {t['title']: t for file in data['testResults'] for t in file['assertionResults']}

def cell(status, title):
    assert title in status, title
    assert status[title]['status'] in ('passed', 'failed'), (title, status[title]['status'])
    return 'зелений' if status[title]['status'] == 'passed' else 'червоний'

def pattern(title):  # -t приймає регулярний вираз: дужки, «+», крапку в назві тесту — екранувати
    return re.sub(r'[.*+?^${}()|[\]\\]', lambda m: '\\' + m.group(0), title)

with open(NEW_FILE, encoding='utf-8') as f:
    clean = f.read()
with open(BLOCK, encoding='utf-8') as f:
    block = f.read().split('\n')
assert clean.count('\n'.join(block)) == 1, 'блок нових тестів у файлі не один'
FIRST = clean[: clean.index('\n'.join(block))].count('\n') + 1  # номер першого рядка блоку у файлі
EXPECTS = [FIRST + k for k, line in enumerate(block) if 'expect(' in line]
hit = set()  # рядки expect, на яких новий тест падав хоча б на одній поломці

def expect_line(test):  # рядок expect, на якому впав тест: перший кадр стека в межах блоку; None — впав не на перевірці
    for n in re.findall(re.escape(NEW_FILE) + r':(\d+):\d+', '\n'.join(test.get('failureMessages') or [])):
        k = int(n)
        if not FIRST <= k < FIRST + len(block):
            continue
        while k >= FIRST:  # перевірка на кілька рядків: кадр показує рядок .toBe(…), а не expect(
            if 'expect(' in block[k - FIRST]:
                return k
            k -= 1
            if k < FIRST or block[k - FIRST].rstrip().endswith(';'):
                return None
        return None
    return None

def run():
    cells = []
    for _, title in ALONE:
        status = statuses([NEW_FILE, '-t', pattern(title)])
        cells.append(cell(status, title))
        hit.add(expect_line(status[title]))
    whole = statuses(FILES)
    return cells + [cell(whole, title) for _, title in WHOLE]

os.makedirs(TMP, exist_ok=True)
# Поломки — на закоміченому тесті: коміт прогону docs.py звірить із поточним (застарілу таблицю не візьме)
assert subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout == '', 'спершу закомітити тест'
with open(TMP + '/mutations-head.txt', 'w', encoding='utf-8') as f:
    f.write(subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, check=True).stdout)
# Прогін на чистому коді: червоний тут зробив би кожну поломку «спійманою»
assert all(c == 'зелений' for c in run()), 'на чистому коді є червоний тест'
rows, caught = [], 0
for i, (name, path, old, new) in enumerate(MUTATIONS, 1):
    assert path != NEW_FILE, name  # поломка у файлі нових тестів зсунула б номери рядків перевірок
    with open(path, encoding='utf-8') as f:
        src = f.read()
    assert src.count(old) == 1, name  # ненайдений якір — провал, а не «зелений» (Т.62)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src.replace(old, new))
        cells = run()
    finally:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src)
    if 'червоний' in cells[: len(ALONE)]:
        caught += 1
    rows.append('| ' + str(i) + ' | ' + name + ' | ' + ' | '.join(cells) + ' |')
    print(rows[-1], flush=True)

cols = [c for c, _ in ALONE + WHOLE]
head = '| № | Поломка | ' + ' | '.join(cols) + ' |\n| --- | --- |' + ' --- |' * len(cols)
with open(TMP + '/table.md', 'w', encoding='utf-8') as f:
    f.write(head + '\n' + '\n'.join(rows) + '\n')
# Підсумок друкує скрипт — виконавець його не переказує (Т.64, знахідка 1)
summary = 'Навмисних поломок — ' + str(len(MUTATIONS)) + '; хоча б один новий тест ловить ' + str(caught) + ' з ' + str(len(MUTATIONS)) + '.'
with open(TMP + '/summary.md', 'w', encoding='utf-8') as f:
    f.write(summary + '\n')
print(summary)
# Перевірки без поломки: рядок з expect( у блоці нових тестів, на якому тест не впав на жодній поломці (Т.66, знахідки 3 і 4)
free = [k for k in EXPECTS if k not in hit]
with open(TMP + '/expects.md', 'w', encoding='utf-8') as f:
    f.write('Перевірок expect у блоці нових тестів — ' + str(len(EXPECTS)) + '; тест падав саме на перевірці — на ' + str(len(EXPECTS) - len(free)) + ' з них.\n')
    for k in free:
        f.write('- рядок ' + str(k) + ': ' + block[k - FIRST].strip() + '\n')
    f.write('Перевірок без поломки немає.\n' if not free else 'Перевірок без поломки — ' + str(len(free)) + '.\n')
print(open(TMP + '/expects.md', encoding='utf-8').read(), end='')
```

### 5. Документи кроку (у гілці до відкриття PR)

Звіт, запис кроку і чернетку опису PR збирає скрипт `docs-py` з блоків цього плану — `report`, `limits`, `record`, `pr-body`, `table-plan` — і з файлів скриптів поломок і чекліста. Виконавець у цих документах руками нічого не набирає і не править: ні чисел, ні слів «немає» чи «нічого» (Т.66: «не має» замість «немає» тричі). Порядок: коміт тесту → `mutations.py` → `checklist.py` (розділ «Чекліст перед PR») → `docs.py` → коміт документів → `check.py` (розділ «PR»). Після будь-якого нового коміту з кодом чи тестами — знову `mutations.py`, `checklist.py` з усіма ключами і зведенням, `docs.py`: застарілих результатів `docs.py` не візьме — відмовить і назве, що перезапустити.

- Звіт `docs/reports/t69-fighter-last-lost.md` з розділами: «Що зроблено», «Навмисні поломки», «Межі», «Чекліст перед PR», «Метрики», «Що з чекліста не вдалося». **Жодного розділу не пропускати** — усі вони є в блоці `report`. Власного підсумку таблиці поломок — ні тут, ні в записі кроку, ні в описі PR — не писати: лише речення зі скрипта (Т.64, знахідка 1).
- Межі — блок `limits`, **словами плану, без переказу**; у звіт його вставляє скрипт. Межу, знайдену під час роботи, виконавець пише в сесії, а не у звіт: у звіт вона піде порцією після аудиту.

<!-- блок: limits -->
```text
- (а) Евакуйована місія в крок не увійшла: зі сторінки її не досягти — `evacuate` з `src/core/combat.ts` не викликає жоден файл `src/ui/` чи `src/main.ts`, кнопки евакуації в бою немає, бот авто-бою не евакуюється. Що після евакуації зонд лишається, тримає тест модуля `src/ui/battle.test.ts` («П15.2 (ADR-0075): «евакуйовано»…»); рядка `#fighter-last` після евакуації не тримає жоден тест.
- (б) Тест прив'язаний до сіду 36 і пресету «складний»: зміна балансу бою чи генерації зондів може дати на цьому сіді перемогу або не дати приземлення під час погоні — тоді тест падає на кроці сценарію, а не на перевірці рядка. На прототипі планувальника на пресеті «норма» з сідів 1–60 переривання приземленням дали сіди 1, 5, 22, 34, 36, 42 і 47 — усі з перемогою; на «складному» серед сідів 1–42 поразку дав лише сід 36.
- (в) Поразку дає авто-бій; програна місія ручним боєм і повторна місія на тому самому зонді тестом не покриті.
- (г) Після програної місії тест не тикає далі: що рядок зникає, коли зонд зрештою відлітає (`ufo_left`), тримає тест Т.51 на сторінці, але не після поразки.
```

<!-- блок: report -->
````text
# Т.69 — рядок #fighter-last лишається після програної місії: звіт

План — `docs/plans/t69-fighter-last-lost.md`. Тест, звіт, запис кроку і PR — Mistral Vibe Code (Mistral Large 4); план — хмарна сесія Claude (Fable 5.2).

## Що зроблено

Новий блок наскрізних тестів на сторінці «Т.69» у кінці `src/main.ui.test.ts`, один тест (сід 36, пресет «складний»): перехоплення ufo1 перервано приземленням, місію на ufo1 одразу програно авто-боєм — на картці результату і після повернення на геосцену рядок `#fighter-last` той самий і один, зонд у списку, кнопка місії є; межі (а)–(г) — у звіті.

## Навмисні поломки

Поломки робив скрипт `/tmp/t69/mutations.py` з блоку `mutations-py` плану: по одній, новий тест «Т.69» — окремим процесом (`-t`), наявний тест Т.66 — прогоном файла `src/main.ui.test.ts` цілком; після кожної поломки файл повернуто.

<таблиця поломок>

<речення з summary.md>

Розбіжності з таблицею плану: <розбіжності з таблицею плану>

## Межі

<межі плану>

## Чекліст перед PR

<рядки чекліста>

## Метрики

- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- Час від запуску сесії до відкриття PR — запише планувальник після аудиту, за своїм годинником

## Що з чекліста не вдалося

<що з чекліста не вдалося>

## Відповідь власника (18.11.2026)

Дослівного тексту питання в документі стану немає. Відповідь: «71: Vibe за шаблоном Т.67 (Рекомендовано)».

## Аудит

Аудит ще не проведено.
````

Місця блоку `report`, які заповнює скрипт `docs-py`: `<таблиця поломок>`, `<речення з summary.md>`, `<розбіжності з таблицею плану>`, `<межі плану>`, `<рядки чекліста>`, `<число рядків>`, `<що з чекліста не вдалося>`. Місць для виконавця в блоці немає.

- Число рядків PR скрипт бере з `./scripts/pr-size.sh origin/main HEAD` на коміті тесту (документи в підрахунок не йдуть). Якщо після `docs.py` був ще коміт з кодом чи тестами — знову `mutations.py`, `checklist.py` (усі ключі і зведення) і `docs.py`: він переписує звіт, запис кроку і чернетку опису цілком.
- Запис кроку в `docs/workflow.md`, розділ «Технічні задачі (позафазні)», після запису Т.68 — блок `record`; вставляє скрипт. Місця, які він заповнює: `<число рядків>`, `<речення з summary.md>`, `<урок>`. Урок — лише про те, що справді сталося в цій сесії: тоді один-два рядки записати у файл `/tmp/t69/lesson.md` і запустити `python3 /tmp/t69/docs.py --lesson-file /tmp/t69/lesson.md`; без уроку — запуск без аргументу, скрипт сам напише «немає». Підпункт «Аудит» і номер PR — після аудиту, порцією планувальника; до аудиту тверджень про його результат не писати.

<!-- блок: record -->
```text
- [x] **Т.69 (рішення власника 18.11.2026, після Т.68): рядок #fighter-last лишається після програної місії — тест на сторінці, перший крок Vibe за шаблоном Т.67.** Мета: кандидат 71 зі змістом кандидата 55 — що рядок `#fighter-last` після перерваного перехоплення лишається, коли місію на зонді програно (зонд лишається в `geo.ufos`), на сторінці не тримав жоден тест. Відповідь власника кнопкою: «71: Vibe за шаблоном Т.67 (Рекомендовано)».
    - Зроблено: новий блок наскрізних тестів на сторінці «Т.69» у кінці `src/main.ui.test.ts`, один тест (сід 36, пресет «складний»): перехоплення ufo1 перервано приземленням, місію на ufo1 одразу програно авто-боєм — на картці результату і після повернення на геосцену рядок `#fighter-last` той самий і один, зонд у списку, кнопка місії є; межі (а)–(г) — у звіті.
    - Виконано: рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>. <речення з summary.md>
    - Урок: <урок>
    - Звіт — `docs/reports/t69-fighter-last-lost.md`
```

<!-- блок: docs-py -->
```python
# Т.69: звіт, запис кроку і чернетка опису PR — з блоків плану; таблиця і речення-підсумок — з файлів скрипта поломок,
# рядки чекліста і «що не вдалося» — з файлів checklist.py, число рядків — з pr-size.sh; слова «немає» пише скрипт.
# Запуск з кореня репозиторію після коміту тесту, mutations.py і checklist.py: python3 /tmp/t69/docs.py [--lesson-file <файл>]
import re, subprocess, sys

TMP, B, V = '/tmp/t69', '/tmp/blocks/', ''  # у порції після аудиту: B = '/tmp/blocks2/', V = '-v2'
REPORT = 'docs/reports/t69-fighter-last-lost.md'
ANCHOR = '    - Звіт — `docs/reports/t68-session-docs-revision.md`\n'  # останній рядок запису попереднього кроку
START = '- [x] **Т.69 '  # початок запису цього кроку
END = '    - Звіт — `' + REPORT + '`\n'  # його останній рядок
WORKFLOW = 'docs/workflow.md'

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().rstrip('\n')

def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text + '\n')

def places(text):  # місця в кутових дужках поза зворотними лапками
    return set(re.findall(r'<[^<>!\n]+>', re.sub(r'`[^`\n]*`', '', text)))

def fresh(name, what):  # результат знято на коміті, після якого поза docs/ нічого не мінялось
    at = read(TMP + '/' + name)
    same = subprocess.run(['git', 'diff', '--quiet', at, 'HEAD', '--', '.', ':(exclude)docs/']).returncode == 0
    assert same, what + ' — з коміту ' + at + ', а код чи тести відтоді мінялись: запустити ще раз, потім docs.py'

fresh('mutations-head.txt', 'таблиця поломок (mutations.py)')
fresh('checklist-head.txt', 'чекліст (checklist.py, усі ключі і зведення)')
table, summary = read(TMP + '/table.md'), read(TMP + '/summary.md')
ours, plan = table.split('\n'), read(B + 'table-plan' + V + '.txt').split('\n')
assert len(ours) == len(plan) and len(ours) > 2, 'у таблиці інше число рядків, ніж у блоці table-plan'
# рядки 0 і 1 — заголовок і риска; розбіжність у них — теж розбіжність
diff = [('заголовок' if i < 2 else str(i - 1)) for i, (a, b) in enumerate(zip(ours, plan)) if a != b]
size = subprocess.run(['./scripts/pr-size.sh', 'origin/main', 'HEAD'], capture_output=True, text=True).stdout
lines = re.findall(r'Разом у підрахунку: (\d+) рядків', size)
assert len(lines) == 1, size
lesson = read(sys.argv[sys.argv.index('--lesson-file') + 1]) if '--lesson-file' in sys.argv else 'немає'
assert lesson and '\n' not in lesson, 'урок — одним рядком'
FILL = {  # місце → значення; жодне з них виконавець руками не заповнює
    '<таблиця поломок>': table,
    '<речення з summary.md>': summary,
    '<розбіжності з таблицею плану>': 'немає' if not diff else ('рядок ' if len(set(diff)) == 1 else 'рядки ') + ', '.join(sorted(set(diff), key=diff.index)),
    '<межі плану>': read(B + 'limits' + V + '.txt'),
    '<рядки чекліста>': read(TMP + '/checklist.md'),
    '<що з чекліста не вдалося>': read(TMP + '/failed.md'),
    '<число рядків>': lines[0],
    '<урок>': lesson,
}

def fill(block, need, keep=()):
    text = read(B + block + V + '.txt')
    # у блоці — рівно ці місця, кожне один раз: зайве місце означало б рядок, який довелося б набирати руками
    assert places(text) == set(need) | set(keep), (block, sorted(places(text) ^ (set(need) | set(keep))))
    for place in need:
        assert text.count(place) == 1, (block, place)
        text = text.replace(place, FILL[place])
    return text

SUM, NUM = '<речення з summary.md>', '<число рядків>'
report = fill('report', ['<таблиця поломок>', SUM, '<розбіжності з таблицею плану>', '<межі плану>', '<рядки чекліста>', NUM, '<що з чекліста не вдалося>'])
record = fill('record', [NUM, SUM, '<урок>'])
body = fill('pr-body', ['<рядки чекліста>', SUM, '<розбіжності з таблицею плану>', NUM], keep=['<рядки vibe-plan-check>'])
assert record.endswith(END.rstrip('\n')), 'запис кроку має закінчуватись рядком «Звіт — …»'

s = open(WORKFLOW, encoding='utf-8').read()
if s.count(START):  # запис уже є (порція після аудиту) — замінити його цілком
    assert s.count(START) == 1 and s.count(END) == 1, 'запис кроку у файлі не один'
    i, j = s.index(START), s.index(END) + len(END)
    assert i < j
    new = s[:i] + record + '\n' + s[j:]
else:
    assert s.count(ANCHOR) == 1, 'якір запису попереднього кроку у файлі не один'
    new = s.replace(ANCHOR, ANCHOR + record + '\n')
# значення вставлено в блок до вставки блоку у файл, тож місць у файлі не побільшало (Т.66: «число рядків» є й у записі Т.63)
assert all(new.count(place) == s.count(place) for place in FILL), 'у docs/workflow.md лишилось незаповнене місце'
with open(WORKFLOW, 'w', encoding='utf-8') as f:
    f.write(new)
write(REPORT, report)
write(TMP + '/pr-body-draft.md', body)
print('звіт, запис кроку і ' + TMP + '/pr-body-draft.md готові; рядків у підрахунку — ' + lines[0] + '; розбіжності з таблицею плану: ' + FILL['<розбіжності з таблицею плану>'] + '; урок: ' + lesson)
```

- Коміт документів — назвою з блоку `commit-docs`: `git add docs/ && git commit -F /tmp/blocks/commit-docs.txt`.

<!-- блок: commit-docs -->
```text
docs(workflow): Т.69 — звіт і запис кроку
```

- Власні уроки про спосіб роботи — один-два рядки в `docs/agents/common.md`, розділ «Лише для Mistral Vibe Code», з позначкою «Т.69» — тим самим комітом документів; це єдиний текст кроку, який виконавець пише сам.
- **Писати лише те, що сам зробив і побачив.** Про секрети репозиторію, налаштування CI і чужі середовища нічого не стверджувати: `mistral-audit` — джоба CI, з пісочниці не видно, чи є в неї ключ. Про аудит виконавець сам нічого не пише: текст розділів «Аудит» звіту, запису кроку й опису PR — зі знахідками, числами аудиторів і причинами відхилених — дає планувальник готовими блоками порції після аудиту. Урок — лише про те, що справді сталося в цій сесії; причин не вигадувати («план був спотворений» — хибний урок Т.51: спотворює вивід інструмента, а не файл). Якщо такого немає — запуск `docs.py` без `--lesson-file`: «немає» — це повна відповідь, а не пропуск (Т.64).

## Обмеження

- **Розмір:** оцінка — 0 рядків коду і ≈ 42 рядки тестів, один PR. Якщо виходить понад 150 рядків — написати про це в сесії до того, як продовжувати; без запису про відхилення в цьому плані мітку `size-deviation` не ставити.
- **Не чіпати:** `src/` (крім `src/main.ui.test.ts`), чужі блоки `describe` у `src/main.ui.test.ts`, `index.html`, `e2e/`, `.github/`, `package.json`, `docs/plans/`, рядки довідника і запису Т.68 з коміту планувальника.
- У доданих рядках (код, коментарі, тести, документи) немає трансліту — лише кирилиця.
- Тести не послаблювати, щоб пройшли.
- Історію не переписувати (без amend, rebase, force-push).
- **Працювати короткими кроками:** одна правка — одна перевірка — коміт. Великий документ писати частинами, а не обмірковувати цілком.

## Чекліст перед PR

`npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.core.json`, `npx tsc --noEmit -p tsconfig.e2e.json`, `npm run lint`, `npm run format:check`, `npm test`, `npm run docs`, `npm run test:e2e`.

Команди запускає скрипт `checklist-py` — по одній за запуск (команда, довша за 10 хв, у пісочниці обривається), на коміті тесту, до `docs.py`: скопіювати `/tmp/blocks/checklist-py.txt` у `/tmp/t69/checklist.py`, далі `python3 /tmp/t69/checklist.py tsc`, потім так само з ключами `tsc-core`, `tsc-e2e`, `lint`, `format`, `test`, `docs`, `e2e`, і наостанок без ключа — `python3 /tmp/t69/checklist.py`: він зводить результати у `/tmp/t69/checklist.md` (рядок на команду — Т.66, знахідка 9) і `/tmp/t69/failed.md` («нічого» або перелік). У звіт і опис PR обидва файли вставляє `docs-py`; результатів руками не писати. Вивід команди, що не пройшла, — у `/tmp/t69/checklist/<ключ>.log`.

Крок не зачіпає сценарій e2e (`e2e/` і те, що він клікає): на e2e в пісочниці — **не більше 10 хвилин** (підготовка браузера — у розділі «Лише для Mistral Vibe Code» довідника; скрипт сам обриває команду на дев'ятій хвилині); не піднявся або падає так само на чистому `origin/main` — скрипт запише це рядком «не пройшла», написати про причину в сесії і йти далі: сценарій прожене CI (це вказівка, а не результат: про результати чеків CI не писати, розділ «PR»). <Крок зачіпає сценарій e2e: e2e обов'язковий (`AGENTS.md`); планувальник пише тут, як виконавець його проганяє і що робити, якщо пісочниця не дає.>

Після коміту документів, перед `check.py`: `git diff origin/main...HEAD -- . ':(exclude)docs/plans/' | grep -niP '^\+.*(?<!«)не має'` нічого не знаходить («немає» — одним словом; «не має» в лапках «…» — цитата, її команда пропускає). Якщо знайшло у власному рядку довідника — виправити новим комітом; якщо в тексті з блоку плану — написати в сесії.

<!-- блок: checklist-py -->
```python
# Т.69: чекліст перед PR — одна команда за запуск, результат — у /tmp/t69/checklist/<ключ>.txt;
# запуск без ключа зводить результати у /tmp/t69/checklist.md і /tmp/t69/failed.md (їх вставляє docs.py).
# Запуск з кореня репозиторію: python3 /tmp/t69/checklist.py <ключ>, наостанок — python3 /tmp/t69/checklist.py
import os, signal, subprocess, sys

TMP = '/tmp/t69'
LIMIT = 540  # секунд на команду: у пісочниці виконавця команда, довша за 10 хв, обривається
COMMANDS = [
    ('tsc', 'npx tsc --noEmit'),
    ('tsc-core', 'npx tsc --noEmit -p tsconfig.core.json'),
    ('tsc-e2e', 'npx tsc --noEmit -p tsconfig.e2e.json'),
    ('lint', 'npm run lint'),
    ('format', 'npm run format:check'),
    ('test', 'npm test'),
    ('docs', 'npm run docs'),
    ('e2e', 'npm run test:e2e'),
]
DIR = TMP + '/checklist'
os.makedirs(DIR, exist_ok=True)
head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()

if len(sys.argv) == 2:
    key = sys.argv[1]
    command = dict(COMMANDS)[key]  # невідомий ключ — помилка, а не порожній результат
    with open(DIR + '/' + key + '.log', 'w', encoding='utf-8') as log:
        # окрема група процесів: за тайм-аутом зупиняється команда разом з усім, що вона запустила (сервер, браузер)
        proc = subprocess.Popen(command.split(), stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = proc.wait(timeout=LIMIT)
            result = 'пройшла' if code == 0 else 'не пройшла (код ' + str(code) + ')'
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            result = 'не пройшла (не завершилась за ' + str(LIMIT // 60) + ' хв)'
    with open(DIR + '/' + key + '.txt', 'w', encoding='utf-8') as f:
        f.write(head + '\n' + result + '\n')
    print('`' + command + '` — ' + result)
    sys.exit(0)

assert len(sys.argv) == 1, 'один ключ за запуск або жодного'
rows, failed = [], []
for key, command in COMMANDS:
    path = DIR + '/' + key + '.txt'
    assert os.path.exists(path), 'команду ще не запущено: python3 ' + TMP + '/checklist.py ' + key
    with open(path, encoding='utf-8') as f:
        at, result = f.read().split('\n')[:2]
    assert at == head, 'результат `' + command + '` — з коміту ' + at + ', а зараз ' + head + ': запустити ще раз'
    rows.append('- `' + command + '` — ' + result)
    if result != 'пройшла':
        failed.append(rows[-1])
with open(TMP + '/checklist.md', 'w', encoding='utf-8') as f:
    f.write('На коміті `' + head + '`:\n\n' + '\n'.join(rows) + '\n')
with open(TMP + '/failed.md', 'w', encoding='utf-8') as f:
    f.write(('\n'.join(failed) if failed else 'нічого') + '\n')
with open(TMP + '/checklist-head.txt', 'w', encoding='utf-8') as f:
    f.write(head + '\n')
print('\n'.join(rows) + '\nЩо не вдалося: ' + ('\n'.join(failed) if failed else 'нічого'))
```

## PR

- Гілка — ця сама: `test/t69-fighter-last-lost` (план уже в ній першим комітом). Комітити в неї, Conventional Commits українською. Назву коміту, яку дає план блоком `commit-…`, не набирати: `git commit -F /tmp/blocks/<ім'я блоку>.txt` (Т.64: назву з плану переписано зі спотворенням). **Помилку в коміті виправляти новим комітом, а не `git commit --amend`** — і до пушу теж (Т.66, знахідка 2).
- **Документи кроку закомітити до відкриття PR** (звіт, запис кроку, рядки довідника): перед `gh pr create` команда `git log --oneline origin/main..HEAD` показує коміт із ними.
- PR у `main`, **не чернеткою**. Назва — **дослівно**: `test(ui): Т.69 — рядок #fighter-last лишається після програної місії`; не набирати — вона ж у блоці `pr-title`.

<!-- блок: pr-title -->
```text
test(ui): Т.69 — рядок #fighter-last лишається після програної місії
```

- Опис PR — **увесь** блоком `pr-body`; місця в ньому заповнюють скрипти: `docs-py` — `<рядки чекліста>`, `<речення з summary.md>`, `<розбіжності з таблицею плану>`, `<число рядків>` (виходить чернетка `/tmp/t69/pr-body-draft.md`), `check-py` — `<рядки vibe-plan-check>` (виходить `/tmp/pr-body.md`). Місць для виконавця в блоці немає; готовий опис руками не правити. Рядок `Iter-Tag` — з початку рядка, без відступу. Розділів понад ці не додавати; розділ «Аудит» до аудиту каже «Аудит ще не проведено», після аудиту його текст дає планувальник.

<!-- блок: pr-body -->
```text
### Що змінено і чому

Перший крок Mistral Vibe Code за шаблоном плану Т.67. Новий блок наскрізних тестів на сторінці «Т.69» у кінці `src/main.ui.test.ts`, один тест (сід 36, пресет «складний»): перехоплення ufo1 перервано приземленням, місію на ufo1 одразу програно авто-боєм — на картці результату і після повернення на геосцену рядок `#fighter-last` той самий і один, зонд у списку, кнопка місії є; межі (а)–(г) — у звіті. Досі на сторінці це не тримав жоден тест: Т.66 тримає виграну місію. Код гри не змінено.

### Критерії приймання

- новий тест «Т.69» зелений на `main` і червоний на поломках таблиці звіту;
- наявні тести не змінено;
- змінено лише `src/main.ui.test.ts` і документи.

### Відповідь власника (18.11.2026)

Дослівного тексту питання в документі стану немає. Відповідь: «71: Vibe за шаблоном Т.67 (Рекомендовано)».

### Перевірка

<рядки чекліста>

- <речення з summary.md>
- Розбіжності з таблицею плану: <розбіжності з таблицею плану>
- Рядків у підрахунку `./scripts/pr-size.sh origin/main HEAD` — <число рядків>
- `vibe-plan-check.mjs` перед відкриттям PR, рядки «Звірено» і «Знахідок» дослівно:
<рядки vibe-plan-check>

### Аудит

Аудит ще не проведено.

Згадка: Т.51, PR #351; Т.66, PR #368; Т.67, PR #369; план — `docs/plans/t69-fighter-last-lost.md`.

Iter-Tag: iter-T.69
```

- Перед відкриттям PR, коли документи кроку вже закомічено, — звірка з планом разом із готовими назвою й описом; її запускає скрипт `check-py` і сам вставляє в опис рядки «Звірено» і «Знахідок» дослівно (Т.66, знахідка 7: рядок «Звірено» в описі було переказано): скопіювати `/tmp/blocks/check-py.txt` у `/tmp/t69/check.py`, далі `python3 /tmp/t69/check.py`. Скрипт друкує весь вивід звірки. Знахідку в коді, тесті чи рядках довідника виконавець виправляє новим комітом (після коміту з кодом чи тестом — знову `mutations.py`, `checklist.py`, `docs.py`) і запускає `check.py` ще раз. Знахідку в тексті, який зібрав `docs.py` (звіт, запис кроку, опис PR), виконавець не править: це текст блоків плану — написати про неї в сесії і відкривати PR; виправить планувальник у плані порцією після аудиту.

<!-- блок: check-py -->
```python
# Т.69: звірка з планом (scripts/vibe-plan-check.mjs) з готовими назвою й описом PR; рядки «Звірено» і «Знахідок»
# скрипт вставляє в опис сам, дослівно. Запуск з кореня репозиторію після коміту документів:
#   python3 /tmp/t69/check.py                 — з чернетки /tmp/t69/pr-body-draft.md робить /tmp/pr-body.md
#   python3 /tmp/t69/check.py --pr <номер>    — після відкриття PR: звіряє назву й опис самого PR (опис — з GitHub)
import subprocess, sys

TMP, B, V = '/tmp/t69', '/tmp/blocks/', ''  # у порції після аудиту: V = '-v2'; B не міняти — назва PR та сама
PLAN = 'docs/plans/t69-fighter-last-lost.md'
BODY = '/tmp/pr-body' + V + '.md'
PLACE = '<рядки vibe-plan-check>'

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().rstrip('\n')

def check(args):
    done = subprocess.run(['node', 'scripts/vibe-plan-check.mjs', '--plan', PLAN, *args], capture_output=True, text=True)
    assert done.returncode in (0, 1), done.stdout + done.stderr  # 0 — знахідок немає, 1 — є; інше — помилка запуску
    tail = [line for line in done.stdout.split('\n') if line.startswith('Звірено:') or line.startswith('Знахід')]
    assert len(tail) == 2, done.stdout
    return done.stdout, '\n'.join('    - ' + line for line in tail)

if '--pr' in sys.argv:
    out, lines = check(['--pr', sys.argv[sys.argv.index('--pr') + 1]])
    print(out, end='')
    number = sys.argv[sys.argv.index('--pr') + 1]
    live = subprocess.run(['gh', 'api', 'repos/sergkarpenko/rubezh/pulls/' + number, '--jq', '.body'], capture_output=True, text=True, check=True).stdout
    same = lines in live.replace('\r\n', '\n')
    print('Рядки звірки в описі PR ті самі.' if same else 'Рядки звірки інші, ніж в описі PR: написати про це в сесії, опис не правити.')
    sys.exit(0 if same and 'Знахідок немає.' in lines else 1)

draft = read(TMP + '/pr-body-draft.md')
assert draft.count(PLACE) == 1, 'у чернетці опису немає місця для рядків звірки — спершу docs.py'
title = read(B + 'pr-title.txt')
lines = '    - (рядки звірки)'
for _ in range(3):  # опис із вставленими рядками звіряється ще раз: рядки в описі — ті, що дав останній запуск
    with open(BODY, 'w', encoding='utf-8') as f:
        f.write(draft.replace(PLACE, lines) + '\n')
    out, new = check(['--title', title, '--body-file', BODY])
    if new == lines:
        break
    lines = new
else:
    raise AssertionError('рядки звірки не усталились за три запуски')
print(out, end='')
print(BODY + ' готовий; назва PR — у ' + B + 'pr-title.txt')
sys.exit(0 if 'Знахідок немає.' in lines else 1)  # знахідки є — виправити і запустити знову або написати про них у сесії
```

- Відкрити PR готовими файлами: `gh pr create --base main --title "$(cat /tmp/blocks/pr-title.txt)" --body-file /tmp/pr-body.md` — без `--draft`. Одразу після цього — `gh pr view <номер> --json isDraft`: має бути `{"isDraft":false}`; якщо `true` — `gh pr ready <номер>` (Т.66, знахідка 1: PR відкрито чернеткою).
- Після відкриття — ще раз звірка, вже самого PR: `python3 /tmp/t69/check.py --pr <номер>`. Якщо рядки звірки інші, ніж в описі, — **нового коміту не робити і опис не правити**, а написати про це в сесії: коміт одразу після відкриття PR скасовує перший прогін чеків, а аудитор, запущений на PR, читає вже не останній коміт (Т.55).
- Після відкриття PR — коротко відповісти в сесії: номер PR, вивід `gh pr view <номер> --json isDraft`, останній рядок `check.py --pr`, вміст `/tmp/t69/failed.md` і перелік «пункт плану — зроблено / ні» з доказом `grep` на кожен рядок «зроблено». Скільки часу зайняв крок, не писати: час рахує планувальник. **Не мержити.**
- **Після відкриття PR — нічого не пушити, доки планувальник не дасть знахідок:** ні документів, ні чисел, ні виправлень. **Про аудит і результати чеків CI нічого не писати** — ні в документах, ні в описі PR: зелені чеки і коментар джоби `mistral-audit` — не аудит кроку, а коротка джоба на зміну опису (≈ 11 с) аудиту не робить зовсім. Розділ «Аудит» лишається «Аудит ще не проведено», доки його текст не дасть планувальник (Т.61: два коміти з документами після відкриття PR і «аудит» з короткої джоби, записаний як пройдений).
