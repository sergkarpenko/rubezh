#!/usr/bin/env python3
# Скрипти кроку Mistral Vibe Code (Т.70, кандидати 48 і 74): навмисні поломки, чекліст перед PR, документи кроку
# і звірка з планом. До Т.70 ці скрипти план нового кроку ніс цілком блоками mutations-py, checklist-py, docs-py,
# check-py (≈ 30 КБ на план); тепер план дає лише дані кроку — блок `step` — і команди.
# Дані кроку — блок плану `step`: словник Python лише з літералів (ast.literal_eval, коду в ньому немає);
# поля — у шаблоні docs/plans/TEMPLATE-vibe.md, розділ «Дані кроку».
# Запуск з кореня репозиторію, блоки плану — уже в /tmp/blocks (node scripts/vibe-plan-blocks.mjs <план> /tmp/blocks):
#   python3 scripts/vibe-step.py mutations                  — таблиця поломок, підсумок, перевірки без поломки
#   python3 scripts/vibe-step.py checklist <ключ>           — одна команда чекліста; без ключа — зведення
#   python3 scripts/vibe-step.py docs [--lesson-file <ф>]   — звіт, запис кроку, рядок довідника, чернетка опису PR
#   python3 scripts/vibe-step.py check [--pr <номер>]       — звірка з планом, рядки звірки в опис PR
# Порція після аудиту: той самий виклик з --v2 — блоки з /tmp/blocks2, імена блоків з суфіксом -v2.
import ast, glob, json, os, re, signal, subprocess, sys

USAGE = 'Використання: python3 scripts/vibe-step.py mutations | checklist [<ключ>] | docs [--lesson-file <файл>] | check [--pr <номер>]; з --v2 — порція після аудиту'
args = sys.argv[1:]
V2 = '--v2' in args
if V2:
    args.remove('--v2')
if not args or args[0] not in ('mutations', 'checklist', 'docs', 'check'):
    sys.exit(USAGE)
CMD, args = args[0], args[1:]
B, V = ('/tmp/blocks2/', '-v2') if V2 else ('/tmp/blocks/', '')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().rstrip('\n')


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text + '\n')


def opt(name):  # значення прапорця; прапорець без значення — помилка, а не мовчазне «немає»
    if name not in args:
        return None
    i = args.index(name)
    assert i + 1 < len(args), name + ' без значення'
    return args[i + 1]


STEP = ast.literal_eval(read(B + 'step.txt'))  # блок `step` плану
assert isinstance(STEP, dict), 'блок step — словник'
NUM = re.fullmatch(r'Т\.(\d+)', STEP['step'])
assert NUM, 'step — «Т.<число>», кирилична Т'
TMP = '/tmp/t' + NUM.group(1)
os.makedirs(TMP, exist_ok=True)
SELF = 'python3 scripts/vibe-step.py '


def head():
    return subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()


# ---------------------------------------------------------------- mutations
# Навмисні поломки — по одній; кожен новий тест — окремим прогоном (-t), наявні тести — прогоном файлів цілком;
# повернення файла; таблиця — у TMP/table.md, підсумок реченням — у TMP/summary.md; перевірки expect нових тестів,
# на яких жодна поломка не впала, — у TMP/expects.md (для планувальника).
def mutations():
    new_file = STEP['new_file']
    block = read(B + STEP['test_block'] + '.txt').split('\n')  # блок вставлено в new_file дослівно
    alone, whole, muts = STEP['alone'], STEP['whole'], STEP['mutations']
    assert alone and muts, 'у step немає нових тестів (alone) чи поломок (mutations)'

    def statuses(extra):
        out = TMP + '/vitest.json'
        if os.path.exists(out):
            os.remove(out)
        subprocess.run(['npx', 'vitest', 'run', *extra, '--reporter=json', '--outputFile=' + out], capture_output=True, text=True)
        assert os.path.exists(out), 'vitest не записав результат: ' + ' '.join(extra)
        with open(out, encoding='utf-8') as f:
            data = json.load(f)
        return {t['title']: t for file in data['testResults'] for t in file['assertionResults']}

    def cell(status, title):
        assert title in status, title
        assert status[title]['status'] in ('passed', 'failed'), (title, status[title]['status'])
        return 'зелений' if status[title]['status'] == 'passed' else 'червоний'

    def pattern(title):  # -t приймає регулярний вираз: дужки, «+», крапку в назві тесту — екранувати
        return re.sub(r'[.*+?^${}()|[\]\\]', lambda m: '\\' + m.group(0), title)

    clean = open(new_file, encoding='utf-8').read()
    assert clean.count('\n'.join(block)) == 1, 'блок нових тестів у файлі не один'
    first = clean[: clean.index('\n'.join(block))].count('\n') + 1  # номер першого рядка блоку у файлі
    expects = [first + k for k, line in enumerate(block) if 'expect(' in line]
    hit = set()  # рядки expect, на яких новий тест падав хоча б на одній поломці

    def expect_line(test):  # рядок expect, на якому впав тест: перший кадр стека в межах блоку; None — впав не на перевірці
        for n in re.findall(re.escape(new_file) + r':(\d+):\d+', '\n'.join(test.get('failureMessages') or [])):
            k = int(n)
            if not first <= k < first + len(block):
                continue
            while k >= first:  # перевірка на кілька рядків: кадр показує рядок .toBe(…), а не expect(
                if 'expect(' in block[k - first]:
                    return k
                k -= 1
                if k < first or block[k - first].rstrip().endswith(';'):
                    return None
            return None
        return None

    def run():
        cells = []
        for _, title in alone:
            status = statuses([new_file, '-t', pattern(title)])
            cells.append(cell(status, title))
            hit.add(expect_line(status[title]))
        status = statuses(STEP['files'])
        return cells + [cell(status, title) for _, title in whole]

    # Поломки — на закоміченому тесті: docs звірить коміт прогону з поточним (застарілу таблицю не візьме)
    assert subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout == '', 'спершу закомітити тест'
    write(TMP + '/mutations-head.txt', head())
    # Прогін на чистому коді: червоний тут зробив би кожну поломку «спійманою»
    assert all(c == 'зелений' for c in run()), 'на чистому коді є червоний тест'
    rows, caught = [], 0
    for i, (name, path, old, new) in enumerate(muts, 1):
        assert path != new_file, name  # поломка у файлі нових тестів зсунула б номери рядків перевірок
        src = open(path, encoding='utf-8').read()
        assert src.count(old) == 1, name  # ненайдений якір — провал, а не «зелений» (Т.62)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(src.replace(old, new))
            cells = run()
        finally:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(src)
        if 'червоний' in cells[: len(alone)]:
            caught += 1
        rows.append('| ' + str(i) + ' | ' + name + ' | ' + ' | '.join(cells) + ' |')
        print(rows[-1], flush=True)

    cols = [c for c, _ in alone + whole]
    top = '| № | Поломка | ' + ' | '.join(cols) + ' |\n| --- | --- |' + ' --- |' * len(cols)
    with open(TMP + '/table.md', 'w', encoding='utf-8') as f:
        f.write(top + '\n' + '\n'.join(rows) + '\n')
    # Підсумок друкує скрипт — виконавець його не переказує (Т.64, знахідка 1)
    summary = 'Навмисних поломок — ' + str(len(muts)) + '; хоча б один новий тест ловить ' + str(caught) + ' з ' + str(len(muts)) + '.'
    write(TMP + '/summary.md', summary)
    print(summary)
    # Перевірки без поломки: рядок з expect( у блоці нових тестів, на якому тест не впав на жодній поломці (Т.66)
    free = [k for k in expects if k not in hit]
    with open(TMP + '/expects.md', 'w', encoding='utf-8') as f:
        f.write('Перевірок expect у блоці нових тестів — ' + str(len(expects)) + '; тест падав саме на перевірці — на ' + str(len(expects) - len(free)) + ' з них.\n')
        for k in free:
            f.write('- рядок ' + str(k) + ': ' + block[k - first].strip() + '\n')
        f.write('Перевірок без поломки немає.\n' if not free else 'Перевірок без поломки — ' + str(len(free)) + '.\n')
    print(open(TMP + '/expects.md', encoding='utf-8').read(), end='')


# ---------------------------------------------------------------- checklist
# Одна команда за запуск, результат — у TMP/checklist/<ключ>.txt; запуск без ключа зводить результати
# у TMP/checklist.md і TMP/failed.md (їх вставляє docs).
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


def chrome():  # обхід E2E_CHROME (Т.69): браузера ревізії Playwright немає, а інша ревізія chromium є — шлях до неї
    if os.environ.get('E2E_CHROME'):
        return None  # обхід уже задано — команда бере його сама
    want = subprocess.run(['node', '-e', "process.stdout.write(require('@playwright/test').chromium.executablePath())"], capture_output=True, text=True).stdout
    if want and os.path.exists(want):
        return None
    roots = [os.environ.get('PLAYWRIGHT_BROWSERS_PATH') or '', os.path.expanduser('~/.cache/ms-playwright'), '/opt/pw-browsers']
    found = [p for r in roots if r for p in glob.glob(r + '/chromium-*/chrome-linux*/chrome')]
    rev = lambda p: int(re.search(r'chromium-(\d+)', p).group(1))
    return max(found, key=rev) if found else None


def checklist():
    out = TMP + '/checklist'
    os.makedirs(out, exist_ok=True)
    at_head = head()
    if len(args) == 1:
        key = args[0]
        assert key in dict(COMMANDS), 'невідомий ключ: ' + key + '; ключі — ' + ', '.join(k for k, _ in COMMANDS)
        command = dict(COMMANDS)[key]
        env, note = os.environ.copy(), ''
        path = chrome() if key == 'e2e' else None
        if path:
            env['E2E_CHROME'] = path
            note = ' (з обходом `E2E_CHROME`: ' + re.search(r'chromium-\d+', path).group(0) + ')'
        with open(out + '/' + key + '.log', 'w', encoding='utf-8') as log:
            # окрема група процесів: за тайм-аутом зупиняється команда разом з усім, що вона запустила (сервер, браузер)
            proc = subprocess.Popen(command.split(), stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
            try:
                code = proc.wait(timeout=LIMIT)
                result = 'пройшла' if code == 0 else 'не пройшла (код ' + str(code) + ')'
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                result = 'не пройшла (не завершилась за ' + str(LIMIT // 60) + ' хв)'
        result += note
        write(out + '/' + key + '.txt', at_head + '\n' + result)
        print('`' + command + '` — ' + result)
        return
    assert not args, 'один ключ за запуск або жодного'
    rows, failed = [], []
    for key, command in COMMANDS:
        path = out + '/' + key + '.txt'
        assert os.path.exists(path), 'команду ще не запущено: ' + SELF + 'checklist ' + key
        at, result = read(path).split('\n')[:2]
        assert at == at_head, 'результат `' + command + '` — з коміту ' + at + ', а зараз ' + at_head + ': запустити ще раз'
        rows.append('- `' + command + '` — ' + result)
        if not result.startswith('пройшла'):
            failed.append(rows[-1])
    write(TMP + '/checklist.md', 'На коміті `' + at_head + '`:\n\n' + '\n'.join(rows))
    write(TMP + '/failed.md', '\n'.join(failed) if failed else 'нічого')
    write(TMP + '/checklist-head.txt', at_head)
    print('\n'.join(rows) + '\nЩо не вдалося: ' + ('\n'.join(failed) if failed else 'нічого'))


# ---------------------------------------------------------------- docs
# Звіт, запис кроку, рядок довідника виконавця і чернетка опису PR — з блоків плану; таблиця і речення-підсумок —
# з файлів mutations, рядки чекліста і «що не вдалося» — з файлів checklist, число рядків — з pr-size.sh;
# слова «немає» пише скрипт. Запуск після коміту тесту, mutations і checklist.
WORKFLOW, HANDBOOK = 'docs/workflow.md', 'docs/agents/common.md'
CI = re.compile(r'(?<![A-Za-z])CI(?![A-Za-z])')


def places(text):  # місця в кутових дужках поза зворотними лапками
    return set(re.findall(r'<[^<>!\n]+>', re.sub(r'`[^`\n]*`', '', text)))


def no_ci(name, text):  # твердження про чеки CI в документах кроку не пишуть ні виконавець, ні планувальник (Т.69)
    if not STEP.get('ci_ok'):
        assert not CI.search(text), name + ': у тексті є «CI» — твердження про чеки CI в документи кроку не писати (ci_ok у step — лише для кроку про сам CI)'


def docs():
    report = STEP['report']
    start = '- [x] **' + STEP['step'] + ' '  # початок запису цього кроку
    end = '    - Звіт — `' + report + '`\n'  # його останній рядок

    def fresh(name, what):  # результат знято на коміті, після якого поза docs/ нічого не мінялось
        at = read(TMP + '/' + name)
        same = subprocess.run(['git', 'diff', '--quiet', at, 'HEAD', '--', '.', ':(exclude)docs/']).returncode == 0
        assert same, what + ' — з коміту ' + at + ', а код чи тести відтоді мінялись: запустити ще раз, потім docs'

    fresh('mutations-head.txt', 'таблиця поломок (' + SELF + 'mutations)')
    fresh('checklist-head.txt', 'чекліст (' + SELF + 'checklist — усі ключі і зведення)')
    table, summary = read(TMP + '/table.md'), read(TMP + '/summary.md')
    ours, plan = table.split('\n'), read(B + 'table-plan' + V + '.txt').split('\n')
    assert len(ours) == len(plan) and len(ours) > 2, 'у таблиці інше число рядків, ніж у блоці table-plan'
    # рядки 0 і 1 — заголовок і риска; розбіжність у них — теж розбіжність
    diff = [('заголовок' if i < 2 else str(i - 1)) for i, (a, b) in enumerate(zip(ours, plan)) if a != b]
    size = subprocess.run(['./scripts/pr-size.sh', 'origin/main', 'HEAD'], capture_output=True, text=True).stdout
    lines = re.findall(r'Разом у підрахунку: (\d+) рядків', size)
    assert len(lines) == 1, size
    lesson_file = opt('--lesson-file')
    lesson = read(lesson_file) if lesson_file else 'немає'
    assert lesson and '\n' not in lesson, 'урок — одним рядком'
    no_ci('урок', lesson)
    fill_map = {  # місце → значення; жодне з них виконавець руками не заповнює
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
        no_ci(block + V, text)
        # у блоці — рівно ці місця, кожне один раз: зайве місце означало б рядок, який довелося б набирати руками
        assert places(text) == set(need) | set(keep), (block, sorted(places(text) ^ (set(need) | set(keep))))
        for place in need:
            assert text.count(place) == 1, (block, place)
            text = text.replace(place, fill_map[place])
        return text

    s_sum, s_num = '<речення з summary.md>', '<число рядків>'
    text_report = fill('report', ['<таблиця поломок>', s_sum, '<розбіжності з таблицею плану>', '<межі плану>', '<рядки чекліста>', s_num, '<що з чекліста не вдалося>'])
    record = fill('record', [s_num, s_sum, '<урок>'])
    body = fill('pr-body', ['<рядки чекліста>', s_sum, '<розбіжності з таблицею плану>', s_num], keep=['<рядки vibe-plan-check>'])
    assert record.endswith(end.rstrip('\n')), 'запис кроку має закінчуватись рядком «Звіт — …»'

    s = open(WORKFLOW, encoding='utf-8').read()
    if s.count(start):  # запис уже є (порція після аудиту) — замінити його цілком
        assert s.count(start) == 1 and s.count(end) == 1, 'запис кроку у файлі не один'
        i, j = s.index(start), s.index(end) + len(end)
        assert i < j
        new = s[:i] + record + '\n' + s[j:]
    else:
        anchor = STEP['anchor']  # останній рядок запису попереднього кроку
        assert s.count(anchor) == 1, 'якір запису попереднього кроку у файлі не один'
        new = s.replace(anchor, anchor + record + '\n')
    # значення вставлено в блок до вставки блоку у файл, тож місць у файлі не побільшало (Т.66)
    assert all(new.count(place) == s.count(place) for place in fill_map), 'у docs/workflow.md лишилось незаповнене місце'
    line = handbook()
    with open(WORKFLOW, 'w', encoding='utf-8') as f:
        f.write(new)
    write(report, text_report)
    write(TMP + '/pr-body-draft.md', body)
    print('звіт, запис кроку' + line + ' і ' + TMP + '/pr-body-draft.md готові; рядків у підрахунку — ' + lines[0] + '; розбіжності з таблицею плану: ' + fill_map['<розбіжності з таблицею плану>'] + '; урок: ' + lesson)


def handbook():  # рядок кроку в розділі «Лише для Mistral Vibe Code» — блоком handbook плану (Т.69), не руками
    path = B + 'handbook' + V + '.txt'
    if not os.path.exists(path):
        return ''
    new = read(path)
    no_ci('handbook' + V, new)
    assert '\n' not in new and not places(new), 'рядок довідника — один рядок без місць'
    m = re.match(r'- \*\*' + re.escape(STEP['step']) + r' [^*\n]*:\*\* ', new)
    assert m, 'рядок довідника починається з «- **' + STEP['step'] + ' (<дата>):** »'
    s = open(HANDBOOK, encoding='utf-8').read()
    assert re.findall(r'^## .*', s, re.M)[-1] == '## Лише для Mistral Vibe Code', 'останній розділ довідника — не «Лише для Mistral Vibe Code»'
    if s.count('\n' + m.group(0)):  # рядок уже є (порція після аудиту) — замінити
        assert s.count('\n' + m.group(0)) == 1, 'рядок кроку в довіднику не один'
        i = s.index('\n' + m.group(0)) + 1
        j = s.index('\n', i)
        s = s[:i] + new + s[j:]
    else:
        assert s.endswith('\n')
        s = s + new + '\n'
    with open(HANDBOOK, 'w', encoding='utf-8') as f:
        f.write(s)
    return ', рядок довідника'


# ---------------------------------------------------------------- check
# Звірка з планом (scripts/vibe-plan-check.mjs) з готовими назвою й описом PR; рядки «Звірено» і «Знахідок»
# скрипт вставляє в опис сам, дослівно. Без --pr — з чернетки TMP/pr-body-draft.md робить /tmp/pr-body[-v2].md;
# з --pr <номер> — після відкриття PR звіряє назву й опис самого PR (опис — з GitHub).
PLACE = '<рядки vibe-plan-check>'


def check():
    plan, body_path = STEP['plan'], '/tmp/pr-body' + V + '.md'

    def run(extra):
        done = subprocess.run(['node', 'scripts/vibe-plan-check.mjs', '--plan', plan, *extra], capture_output=True, text=True)
        assert done.returncode in (0, 1), done.stdout + done.stderr  # 0 — знахідок немає, 1 — є; інше — помилка запуску
        tail = [line for line in done.stdout.split('\n') if line.startswith('Звірено:') or line.startswith('Знахід')]
        assert len(tail) == 2, done.stdout
        return done.stdout, '\n'.join('    - ' + line for line in tail)

    number = opt('--pr')
    if number:
        out, lines = run(['--pr', number])
        print(out, end='')
        live = subprocess.run(['gh', 'api', 'repos/sergkarpenko/rubezh/pulls/' + number, '--jq', '.body'], capture_output=True, text=True, check=True).stdout
        same = lines in live.replace('\r\n', '\n')
        print('Рядки звірки в описі PR ті самі.' if same else 'Рядки звірки інші, ніж в описі PR: написати про це в сесії, опис не правити.')
        sys.exit(0 if same and 'Знахідок немає.' in lines else 1)

    draft = read(TMP + '/pr-body-draft.md')
    assert draft.count(PLACE) == 1, 'у чернетці опису немає місця для рядків звірки — спершу docs'
    title = read(B + 'pr-title.txt')
    lines = '    - (рядки звірки)'
    for _ in range(3):  # опис із вставленими рядками звіряється ще раз: рядки в описі — ті, що дав останній запуск
        write(body_path, draft.replace(PLACE, lines))
        out, new = run(['--title', title, '--body-file', body_path])
        if new == lines:
            break
        lines = new
    else:
        raise AssertionError('рядки звірки не усталились за три запуски')
    print(out, end='')
    print(body_path + ' готовий; назва PR — у ' + B + 'pr-title.txt')
    sys.exit(0 if 'Знахідок немає.' in lines else 1)  # знахідки є — виправити і запустити знову або написати про них у сесії


{'mutations': mutations, 'checklist': checklist, 'docs': docs, 'check': check}[CMD]()
