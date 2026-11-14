# Навмисні поломки scripts/mistral-audit.mjs (Т.37): кожна — одна заміна в копії скрипта в /tmp;
# самоперевірка копії має стати червоною. Запуск з кореня репозиторію: python3 docs/reports/t37/mutations.py
import subprocess,sys,shutil,os
src=open('scripts/mistral-audit.mjs',encoding='utf8').read()
muts=[
("SKIP не діє","if (SKIP.test(file)) {","if (false) {"),
("без межі файла","const clipped = text.length > MAX_FILE;","const clipped = false;"),
("без межі дифа","if (total + text.length > MAX_DIFF) {","if (false) {"),
("запис про обрізку до перевірки межі","if (clipped) omitted.push(","omitted.push("),
("порожній диф не виняток","if (entries.length === 0) throw new Error('порожній диф');",""),
("два крапки замість трьох","git('diff', '--name-status', '-M', '-z', `${base}...${head}`)","git('diff', '--name-status', '-M', '-z', `${base}..${head}`)"),
("без пошуку перейменувань у переліку","git('diff', '--name-status', '-M', '-z',","git('diff', '--name-status', '--no-renames', '-z',"),
("перейменування без старого шляху","(e.from ? [e.from, file] : [file])","[file]"),
("без literal","`:(top,literal)${f}`","f"),
("документи не наприкінці","entries.sort((a, b) => isDoc(a) - isDoc(b));",""),
("зміна аудитора не позначена","const self = entries.some((e) => SELF.includes(e.file) || SELF.includes(e.from));","const self = false;"),
("правила з гілки","git('show', `${pr.base.sha}:AGENTS.md`)","git('show', `${pr.head.sha}:AGENTS.md`)"),
("код розділів сталий","randomBytes(6).toString('hex')","'000000000000'"),
("розділи без коду","`=== ${name} ${nonce} ===`","`=== ${name} ===`"),
("без обрізання findings",".slice(0, MAX_FINDINGS)\n",".slice(0, 99)\n"),
("severity як є","SEVERITIES.includes(f.severity) ? f.severity : 'середня'","f.severity"),
("kind як є","f.kind === 'перевірене' ? 'перевірене' : 'припущення'","f.kind"),
("line як є","Number.isInteger(f.line) && f.line > 0 ? f.line : null","f.line"),
("findings не масив","|| !Array.isArray(data.findings)",""),
("без огорожі","raw.trim().replace(/^```(?:json)?\\s*|\\s*```$/g, '')","raw"),
("safe без @",".replace(/@/g, '@\\u200b')",""),
("safe без <",".replace(/</g, '&lt;')",""),
("safe без переносів",".replace(/[\\r\\n]+/g, ' ')",""),
("safe без Markdown",".replace(/[\\\\*_[\\]()!#~|]/g, '\\\\$&')",""),
("safe без бектика",".replace(/`/g, \"'\")",""),
("claim без safe","— ${safe(f.claim)}","— ${f.claim}"),
("evidence без safe","Доказ: ${safe(f.evidence)}","Доказ: ${f.evidence}"),
("підсумок без префікса і safe","`Підсумок: ${safe(r.summary)}`","r.summary"),
("перелік не показаного без межі","${shortList(r.omitted)","${r.omitted"),
("коментар без межі","cut(out.join('\\n\\n'), MAX_COMMENT)","out.join('\\n\\n')"),
("без попередження про аудитора","if (r.self) out.push(","if (false) out.push("),
("повтор на 401","if (res.status === 429 || res.status >= 500) {","if (res.status >= 400) {"),
("без повтору 429","if (res.status === 429 || res.status >= 500) {","if (res.status >= 500) {"),
("без повтору 5xx","if (res.status === 429 || res.status >= 500) {","if (res.status === 429) {"),
("помилка мережі з текстом","(${e?.name ?? 'помилка мережі'})","(${e?.message})"),
("дві спроби","const ATTEMPTS = 3;","const ATTEMPTS = 2;"),
("без перевірки ключа","if (!env.MISTRAL_API_KEY) throw new Error('у репозиторії немає секрету MISTRAL_API_KEY');",""),
("будь-який автор коментаря"," && c.user?.login === 'github-actions[bot]'",""),
("завжди POST","if (mine) return","if (false) return"),
("без позначки в пошуку","c.body.startsWith(MARKER) && ",""),
("лише перша сторінка коментарів","page <= 10 && !mine","page <= 1 && !mine"),
("модель без перевірки","/^[a-z0-9][a-z0-9.-]{2,60}$/.test(env.MISTRAL_MODEL ?? '')","env.MISTRAL_MODEL"),
("збій GitHub кидає","result.posted = false;","throw e;"),
("не PR не пропуск","if (!pr) {","if (false) {"),
("збій без коментаря","if (!r.ok) return `${head}**Аудиту не було:**","if (!r.ok) return `${head}**Збій:**"),
("перший рядок помилки не обрізано","result.reason = String(e?.message ?? e).split('\\n')[0];","result.reason = String(e?.message ?? e);"),
("поле не обрізано","claim: cut(str(f.claim), MAX_FIELD)","claim: str(f.claim)"),
("порожні записи лишаються","&& str(f.claim).trim() !== ''",""),
("github не перевіряє код","if (!res.ok) throw new Error(`GitHub ${method} ${path}: код ${res.status}`);",""),
]
os.makedirs('/tmp/mut/scripts',exist_ok=True)
surv=[]
for name,a,b in muts:
    if src.count(a)!=1: print('НЕ ЗНАЙДЕНО',name,src.count(a)); continue
    open('/tmp/mut/scripts/mistral-audit.mjs','w',encoding='utf8').write(src.replace(a,b))
    r=subprocess.run(['node','/tmp/mut/scripts/mistral-audit.mjs','--self-test'],capture_output=True,text=True,timeout=120)
    if r.returncode==0: surv.append(name)
print('поломок',len(muts),'вижило',len(surv),surv)
