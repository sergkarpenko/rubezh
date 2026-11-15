# Навмисні поломки після поділу аудитора Mistral на два файли (Т.42, ADR-0099).
# 1) Усі поломки Т.41 (перелік береться з docs/reports/t41/mutations.py) — над копією
#    scripts/mistral-audit.mjs поруч із незміненою копією самоперевірки: поділ не мав послабити жодної.
# 2) Нові — на код, що з'явився з поділом (обидва файли).
# Кожна поломка — одна заміна; самоперевірка копії має стати червоною. «Зелена» тут — як у джобі CI
# (bash з pipefail і grep): код 0 і останній рядок закінчується на «помилок 0». Поломки, що ховають
# провал (режими *-red), перевіряються разом зі штучним провалом однієї перевірки: провал мусить
# лишитись видимим хоча б одному з двох сигналів — кодом або рядком підсумку.
# ONLY=<початок назви> — прогнати частину переліку.
# Запуск з кореня репозиторію: python3 docs/reports/t42/mutations.py
import subprocess,sys,os,tempfile,shutil
MAIN='scripts/mistral-audit.mjs'; TEST='scripts/mistral-audit-selftest.mjs'
src={MAIN:open(MAIN,encoding='utf8').read(),TEST:open(TEST,encoding='utf8').read()}
old=open('docs/reports/t41/mutations.py',encoding='utf8').read()
ns={}; exec(old[old.index('muts=['):old.index('\n]\n')+3],ns)
muts=[(MAIN,n,a,b,'selftest') for n,a,b in ns['muts']]
muts+=[
(MAIN,"T.42: файл самоперевірки — не файл аудитора","'scripts/mistral-audit-selftest.mjs', '.github","'scripts/x.mjs', '.github",'selftest'),
(MAIN,"T.42: прапорець --self-test ковтає червоний код","process.exit(e?.status || 1);","process.exit(0);",'flag-red'),
(MAIN,"T.42: прапорець --self-test нічого не запускає","execFileSync(process.execPath, [file], { stdio: 'inherit' });","",'flag-green'),
(TEST,"T.42: окремий запуск завжди зелений","process.exit((await selfTest()) ? 0 : 1);","process.exit(0);",'file-red'),
(TEST,"T.42: провал без рядка підсумку з числом","помилок ${failed.length}`","помилок 0`",'file-red'),
(TEST,"T.42: самоперевірка не запускається при прямому виклику","=== resolve(process.argv[1])) {","=== 'x') {",'file-green'),
]
BREAK=("checks++;","checks++; if (checks === 7) cond = false;")  # штучний провал однієї перевірки
def run(d,args):
    try:
        r=subprocess.run(['node']+args,capture_output=True,text=True,timeout=120,cwd=d)
        return r.returncode,r.stdout
    except subprocess.TimeoutExpired: return 124,''
green=lambda rc,out: rc==0 and out.rstrip().endswith('помилок 0')
muts=[m for m in muts if m[1].startswith(os.environ.get('ONLY',''))]
d=tempfile.mkdtemp(prefix='t42-mut-'); alive=[]
for path,name,a,b,mode in muts:
    if src[path].count(a)<1: print('[НЕ ЗНАЙДЕНО]',name); alive.append(name); continue
    files=dict(src); files[path]=src[path].replace(a,b,1)
    if mode in('flag-red','file-red'):   # поломка ховає провал: провал створюємо штучно
        assert files[TEST].count(BREAK[0])==1; files[TEST]=files[TEST].replace(*BREAK)
    for p,t in files.items(): open(os.path.join(d,os.path.basename(p)),'w',encoding='utf8').write(t)
    args=['mistral-audit.mjs','--self-test'] if mode.startswith('flag') else ['mistral-audit-selftest.mjs']
    caught=not green(*run(d,args))
    if not caught: alive.append(name)
shutil.rmtree(d)
print(f'поломок {len(muts)}, виявлено {len(muts)-len(alive)}, не виявлено {len(alive)}')
for n in alive: print('  [ЖИВА]',n)
sys.exit(1 if alive else 0)
