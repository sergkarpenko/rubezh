# Навмисні поломки нового коду scripts/mistral-audit.mjs (Т.41, ADR-0098): кожна — одна заміна в копії
# скрипта в тимчасовій теці; самоперевірка копії має стати червоною.
# Запуск з кореня репозиторію: python3 docs/reports/t41/mutations.py
import subprocess,sys,os,tempfile
src=open('scripts/mistral-audit.mjs',encoding='utf8').read()
muts=[
("згадки: лише кирилична Т","(?<![\\p{L}\\d.])[TТ]\\.","(?<![\\p{L}\\d.])Т\\."),
("згадки: без перевірки знака перед Т","(?<![\\p{L}\\d.])[TТ]","[TТ]"),
("згадки: крок без межі цифр","(\\d{1,3})(?!\\d)/gu","(\\d{1,3})/gu"),
("згадки: ADR без межі цифр","ADR-(\\d{4})(?!\\d)/g","ADR-(\\d{4})/g"),
("контекст: у довідники йде не лише .md",".filter((f) => f.endsWith('.md'));",".filter(Boolean);"),
("контекст: номер кроку без межі цифр","${n}(?!\\\\d)`","${n}`"),
("контекст: запис кроку — один рядок","while (end < flow.length && /^\\s+\\S/.test(flow[end])) end++;",""),
("контекст: запис кроку тягне сусідні","/^\\s+\\S/.test(flow[end])","flow[end].startsWith('- [')"),
("контекст: кроків без межі","else if (steps.length < MAX_STEPS) {","else if (true) {"),
("контекст: ADR без межі","} else if (adrs.length < MAX_ADRS) {","} else if (true) {"),
("контекст: «у дифі» не відрізняється від «ніде»","const added = diffNames.some(","const added = [].some("),
("контекст: немає workflow.md — виняток","git('ls-tree', '--name-only', base, 'docs/workflow.md').trim() ?","true ?"),
("контекст: порожній розділ «немає в базі»","if (missing.length) sections.push(","sections.push("),
("контекст: не знайдений крок мовчки пропущено","if (at < 0) missing.push(","if (at < 0) [].push("),
("код опису без назви","update(`${d.title}\\n${d.body}`)","update(`${d.body}`)"),
("код опису без опису","update(`${d.title}\\n${d.body}`)","update(`${d.title}`)"),
("мітка дублюється","const lines = text.split('\\n').filter((l) => !l.startsWith(STALE));","const lines = text.split('\\n');"),
("мітка ставиться завжди","if (stale && at >= 0) lines.splice","if (at >= 0) lines.splice"),
("мітка не ставиться","if (stale && at >= 0) lines.splice","if (false) lines.splice"),
("мітка над заголовком","lines.splice(at + 1, 0, STALE_LINE)","lines.splice(at, 0, STALE_LINE)"),
("коментар без коду опису","? `<!-- mistral-audit-desc:${r.desc} -->\\n` : '';","? '' : '';"),
("коментар: мітка без умови","r.stale === true\n","true\n"),
("коментар: джерело опису завжди API","r.descApi ? 'прочитано через API під час прогону'","true ? 'прочитано через API під час прогону'"),
("коментар: чеки без екранування","safe(r.checks.join('; '))","r.checks.join('; ')"),
("опис завжди з події","const desc = live ?? {","const desc = false || {"),
("збій API опису читається як порожній опис","  } catch {\n    return null;\n  }\n}\n\n/**\n * Результати","  } catch {\n    return { title: '', body: '' };\n  }\n}\n\n/**\n * Результати"),
("подія edited іде в аудит","if (event.action === 'edited') {","if (false) {"),
("edited: збій GitHub — виняток назовні","return await markEdited({ gh, repo, number: pr.number, desc, log });","return markEdited({ gh, repo, number: pr.number, desc, log });"),
("edited: порівняння навпаки","const stale = seen !== descHash(desc);","const stale = seen === descHash(desc);"),
("edited: без коду опису — мітимо","if (!seen) {","if (false) {"),
("чеки: своя джоба рахується",".filter((r) => r.name !== self);",".filter(Boolean);"),
("чеки: без очікування","for (let i = 0; i < CHECK_POLLS; i++) {","for (let i = 0; i < 1; i++) {"),
("чеки: пауза перед першим опитуванням","if (i > 0) await sleep(CHECK_PAUSE_MS);","await sleep(CHECK_PAUSE_MS);"),
("чеки: збій API валить аудит","  } catch {\n    return null;\n  }\n  return runs.map","  } catch (e) {\n    throw e;\n  }\n  return runs.map"),
("чеки: незавершений показано як завершений","r.status === 'completed' ? r.conclusion : r.status}`","r.conclusion ?? 'success'}`"),
("чеки: без сортування",": r.status}`).sort();",": r.status}`);"),
("чеки: порожній перелік — порожній розділ","checks.join('\\n') || 'чеків немає'","checks.join('\\n')"),
("запит без контексту","nonce, extra });","nonce });"),
("запит: контекст без коду розділів","...extra.map(([name, text]) => `${h(name)}\\n${text}`),","...extra.map(([name, text]) => `=== ${name} ===\\n${text}`),"),
("зміна опису під час прогону не помічена","result.stale = Boolean(after) && descHash(after) !== result.desc;","result.stale = false;"),
("мітка без повторного читання опису","const after = await readDesc(gh, repo, pr.number);","const after = live;"),
("після збою API опис не перечитується","const after = await readDesc(gh, repo, pr.number);","const after = live && (await readDesc(gh, repo, pr.number));"),
("прапорець джерела опису","descApi: live !== null };","descApi: true };"),
("згадки: з повторами","return [...new Set([...all(text), ...more.flatMap(byCount)])];","return [...all(text), ...more.flatMap(byCount)];"),
("згадки: диф без порядку за частотою",".sort((x, y) => count.get(y) - count.get(x));",";"),
("згадки: диф поперед опису","[...new Set([...all(text), ...more.flatMap(byCount)])]","[...new Set([...more.flatMap(byCount), ...all(text)])]"),
("згадки лише з опису, без дифа","diff.names, diff.added);","diff.names);"),
("згадки з усіх рядків дифа, не лише доданих",".filter((l) => l.startsWith('+') && !l.startsWith('+++'))",".filter(Boolean)"),
("згадки: код поперед документів","added: [added.docs.join('\\n'), added.code.join('\\n')]","added: [added.code.join('\\n'), added.docs.join('\\n')]"),
("контекст: довідники без межі","clip(bookText, MAX_HANDBOOKS, 'довідники')","bookText"),
("контекст: запис без обрізки","clip(flow.slice(at, end).join('\\n'), MAX_RECORD, `запис Т.${n}`)","flow.slice(at, end).join('\\n')"),
("контекст: ADR без обрізки","${clip(show(file), MAX_ADR, `ADR-${n}`)}","${show(file)}"),
("контекст: звіт без обрізки","${clip(show(file), MAX_REPORT, `звіт Т.${n}`)}","${show(file)}"),
("контекст: обрізане не названо","if (t.length > max) clipped.push(name);",""),
("контекст: звітів без межі","reports.length >= MAX_REPORTS","false"),
("контекст: звіти без розділу","if (reports.length) sections.push(","if (false) sections.push("),
("контекст: відкритий запис «- [ ]» не знаходиться","^- \\\\[[ x]\\\\]","^- \\\\[[x]\\\\]"),
("межа: звітів три","const MAX_REPORTS = 2;","const MAX_REPORTS = 3;"),
("межа: ADR сім","const MAX_ADRS = 6;","const MAX_ADRS = 7;"),
("межа: запис кроку вдесятеро довший","const MAX_RECORD = 12_000;","const MAX_RECORD = 120_000;"),
("межа: пауза опитування чеків нуль","const CHECK_PAUSE_MS = 20_000;","const CHECK_PAUSE_MS = 0;"),
("межа: опитувань чеків тисяча","const CHECK_POLLS = 15;","const CHECK_POLLS = 1000;"),
("чеки: без codecov/patch в обов'язкових","['test', 'e2e', 'pr-size', 'codecov/patch'];","['test', 'e2e', 'pr-size'];"),
("чеки: обов'язковий чек може бути незавершеним","r.name === name && r.status === 'completed'))) break;","r.name === name))) break;"),
("чеки: досить одного обов'язкового","REQUIRED_CHECKS.every((name)","REQUIRED_CHECKS.some((name)"),
("коментар: обрізане не показано","ctx.clipped.length ?","false ?"),
("коментар: код опису без перевірки формату","/^[0-9a-f]{12}$/.test(r.desc ?? '')","true"),
("edited: запис без змін","if (text !== mine.body) {","if (true) {"),
("edited: без повторного читання коментаря перед записом","if ((await findComment(gh, repo, number))?.body !== mine.body) continue;",""),
("аудит: правка опису між читанням і записом не помічена","if (last && descHash(last) !== result.desc) {","if (false) {"),
("аудит: опис після запису перечитується й тоді, коли мітка вже є","const last = result.stale ? null : await readDesc(gh, repo, pr.number);","const last = await readDesc(gh, repo, pr.number);"),
]
d=tempfile.mkdtemp(prefix='t41-mut-'); alive=[]
for name,a,b in muts:
    if src.count(a)<1: print('[НЕ ЗНАЙДЕНО]',name); alive.append(name); continue
    f=os.path.join(d,'m.mjs'); open(f,'w',encoding='utf8').write(src.replace(a,b,1))
    try: r=subprocess.run(['node',f,'--self-test'],capture_output=True,text=True,timeout=120); red=r.returncode!=0
    except subprocess.TimeoutExpired: red=True
    if not red: alive.append(name)
subprocess.run(['rm','-rf',d])
print(f'поломок {len(muts)}, виявлено {len(muts)-len(alive)}, не виявлено {len(alive)}')
for n in alive: print('  [ЖИВА]',n)
sys.exit(1 if alive else 0)
