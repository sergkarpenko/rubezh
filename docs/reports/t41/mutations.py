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
("згадки: з повторами","const uniq = (re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];","const uniq = (re) => [...text.matchAll(re)].map((m) => m[1]);"),
("контекст: у довідники йде не лише .md",".filter((f) => f.endsWith('.md'));",".filter(Boolean);"),
("контекст: довідники без межі","cut(bookText, MAX_HANDBOOKS)","bookText"),
("контекст: номер кроку без межі цифр","${n}(?!\\\\d)`","${n}`"),
("контекст: запис кроку — один рядок","while (end < flow.length && /^\\s+\\S/.test(flow[end])) end++;",""),
("контекст: запис кроку тягне сусідні","/^\\s+\\S/.test(flow[end])","flow[end].startsWith('- [')"),
("контекст: кроків без межі","else if (steps.length < MAX_STEPS) {","else if (true) {"),
("контекст: ADR без межі","} else if (adrs.length < MAX_ADRS) {","} else if (true) {"),
("контекст: запис без обрізки","records.push(cut(flow.slice(at, end).join('\\n'), MAX_RECORD));","records.push(flow.slice(at, end).join('\\n'));"),
("контекст: ADR без обрізки","${cut(show(file), MAX_ADR)}","${show(file)}"),
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
("edited: запис без змін","if (text !== mine.body) await gh('PATCH'","if (true) await gh('PATCH'"),
("edited: без коду опису — мітимо","if (!seen) {","if (false) {"),
("чеки: своя джоба рахується",".filter((r) => r.name !== self);",".filter(Boolean);"),
("чеки: без мінімального числа","runs.length >= MIN_CHECKS && runs.every","runs.every"),
("чеки: досить одного завершеного","runs.every((r) => r.status === 'completed')) break;","runs.some((r) => r.status === 'completed')) break;"),
("чеки: без очікування","for (let i = 0; i < CHECK_POLLS; i++) {","for (let i = 0; i < 1; i++) {"),
("чеки: пауза перед першим опитуванням","if (i > 0) await sleep(CHECK_PAUSE_MS);","await sleep(CHECK_PAUSE_MS);"),
("чеки: збій API валить аудит","  } catch {\n    return null;\n  }\n  return runs.map","  } catch (e) {\n    throw e;\n  }\n  return runs.map"),
("чеки: незавершений показано як завершений","r.status === 'completed' ? r.conclusion : r.status}`","r.conclusion ?? 'success'}`"),
("чеки: без сортування",": r.status}`).sort();",": r.status}`);"),
("чеки: порожній перелік — порожній розділ","checks.join('\\n') || 'чеків немає'","checks.join('\\n')"),
("запит без контексту","nonce, extra });","nonce });"),
("запит: контекст без коду розділів","...extra.map(([name, text]) => `${h(name)}\\n${text}`),","...extra.map(([name, text]) => `=== ${name} ===\\n${text}`),"),
("згадки лише з опису, без дифа","`${desc.title}\\n${desc.body}\\n${added}`","`${desc.title}\\n${desc.body}`"),
("згадки з усіх рядків дифа, не лише доданих","filter((l) => l.startsWith('+') && !l.startsWith('+++'))","filter(Boolean)"),
("зміна опису під час прогону не помічена","result.stale = Boolean(after) && descHash(after) !== result.desc;","result.stale = false;"),
("мітка без повторного читання опису","const after = await readDesc(gh, repo, pr.number);","const after = live;"),
("після збою API опис не перечитується","const after = await readDesc(gh, repo, pr.number);","const after = live && (await readDesc(gh, repo, pr.number));"),
("прапорець джерела опису","descApi: live !== null };","descApi: true };"),
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
