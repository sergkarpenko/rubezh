# Навмисні поломки Т.62: кожна — заміна в копії scripts/vibe-plan-check.mjs, самоперевірка має стати червоною.
import shutil, subprocess, sys, tempfile, time, os
root = sys.argv[1]
F = 'scripts/vibe-plan-check.mjs'
M = [
 ('апостроф не з’єднує слово', "(?:['’ʼ][${CYR}]+)*`, 'g')", "`, 'g')"),
 ('апостроф не нормалізується', """.replace(/[’ʼ]/g, "'")""", ''),
 ('без [іь]? у закінченні', "const ENDING = new RegExp(`^[іь]?${NOUN}?$`);", "const ENDING = new RegExp(`^${NOUN}?$`);"),
 ('без суфіксів прикметника', '!ENDING.test(rest) && !DERIVED.test(rest)', '!ENDING.test(rest)'),
 ('стара межа довжини', "  if (!w.startsWith(sb)) return false;", "  if (!w.startsWith(sb) || w.length > sb.length + 3) return false;"),
 ('без ы, ой', "|ы|ой)'", ")'"),
 ('місця плану з кодом', "places: new Set(noCode(blocks.join('\\n'))", "places: new Set((blocks.join('\\n'))"),
 ('місця в рядках з кодом', 'noCode(text).matchAll(PLACE)', 'text.matchAll(PLACE)'),
 ('без буквального <…>', '(plan.places.has(p) || ELLIPSIS.test(p))', '(plan.places.has(p))'),
 ('HTML-коментар — місце', 'const PLACE = new RegExp(`<(?!!--)', 'const PLACE = new RegExp(`<'),
 ('місця з усього плану', "places: new Set(noCode(blocks.join('\\n'))", "places: new Set(noCode(plan)"),
 ('allow не діє на місця', ' || allow.has(lower(p))) continue;', ') continue;'),
 ('після аудиту — ніколи', 'afterAudit: /^## Після аудиту/m.test(plan),', 'afterAudit: false,'),
 ('--after-audit ігнорується', 'plan.afterAudit ||= Boolean(opt.afterAudit);', ''),
 ('--after-audit без i--', '      i--;\n      continue;', '      continue;'),
 ('«ще не» — твердження', '(?!не\\\\s|ще\\\\s)', ''),
 ('без межі слова перед «аудит»', '`${NC}аудит', '`аудит'),
 ('без правила mistral-audit', "  new RegExp(`mistral-audit", "  0 && new RegExp(`mistral-audit"),
 ('після аудиту: звіт не дивимось', "...(report?.includes(NOT_YET)", "...(false"),
 ('після аудиту: опис не дивимось', "...(body?.includes(NOT_YET)", "...(false"),
 ('вказівки: відповідь власника не виключено', ".replace(owner, '')", ''),
 ('вказівки: терміни не виключено', ".replace(section(plan, /Терміни гри/), '')", ''),
 ('вказівки: рядки блоків не виключено', ' && !inBlocks.has(l));', ');'),
 ('вказівки і без блоків', "const prose = blocks.length ? plan.replace", "const prose = 1 ? plan.replace"),
 ('вказівки від 200 знаків', '.filter((l) => l.length >= 60 &&', '.filter((l) => l.length >= 200 &&'),
 ('вказівки: заголовки й таблиці', ".filter((l) => !/^\\s*(#|\\||```|<!--)/.test(l))", ''),
 ('checkInstructions не в main', '    ...checkInstructions([...docs, ...bodyItems], plan),\n', ''),
 ('checkAudit не в main', '    ...checkAudit([...docs, ...bodyItems], plan, report, body),\n', ''),
 ('checkPlaces без опису PR', '...checkPlaces([...items, ...bodyItems, ...titleItems]', '...checkPlaces([...items, ...titleItems]'),
 ('checkAudit без опису PR', 'checkAudit([...docs, ...bodyItems]', 'checkAudit([...docs]'),
]
t0 = time.time(); red = 0
src = open(os.path.join(root, F)).read()
for i, (name, a, b) in enumerate(M, 1):
    n = src.count(a)
    if n != 1: print(f'{i}. {name}: якір знайдено {n} раз(и)'); continue
    d = tempfile.mkdtemp(prefix='t62-mut-')
    os.makedirs(f'{d}/scripts')
    open(f'{d}/{F}', 'w').write(src.replace(a, b))
    shutil.copy(os.path.join(root, 'scripts/vibe-plan-check-selftest.mjs'), f'{d}/scripts/')
    r = subprocess.run(['node', 'scripts/vibe-plan-check-selftest.mjs'], cwd=d, capture_output=True, text=True, timeout=120)
    last = (r.stdout.strip().splitlines() or ['(порожньо)'])[-1]
    red += r.returncode != 0
    print(f"{i}. {name}: {'червона' if r.returncode else 'ЗЕЛЕНА'} — {last[:90]}")
    shutil.rmtree(d)
print(f'Червоних: {red} із {len(M)}. Час: {time.time()-t0:.0f} с')
