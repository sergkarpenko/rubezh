import fs from 'node:fs';
// Т.162: межі частин кроку `npx playwright install --with-deps chromium` у журналах джоб e2e.
// Запуск: node docs/reports/t162/measure.mjs <тека> <id джоби>…; у теці — log-<id>.txt
// (gh api repos/sergkarpenko/rubezh/actions/jobs/<id>/logs) і meta-<id>.txt
// (gh api …/actions/jobs/<id> --jq '"\(.started_at) \(.completed_at) \(.run_id)"').
const [dir, ...ids] = process.argv.slice(2);
const t = (l) => Date.parse(l.slice(0, 28));
const rows = [];
for (const id of ids) {
  const L = fs.readFileSync(`${dir}/log-${id}.txt`, 'utf8').split('\n');
  const f = (re) => L.find((l) => re.test(l));
  const fl = (re) => [...L].reverse().find((l) => re.test(l));
  const s = t(f(/##\[group\]Run npx playwright install/));
  const aptUpdEnd = t(f(/Reading package lists/));
  const dl = t(f(/Downloading Chrome for Testing/));
  const dlEnd = t(fl(/downloaded to \/home\/runner\/.cache\/ms-playwright/));
  const e2e = t(f(/##\[group\]Run npm run test:e2e/));
  const [js, je, run] = fs.readFileSync(`${dir}/meta-${id}.txt`, 'utf8').trim().split(' ');
  const sizes = L.filter((l) => /% of [\d.]+ MiB/.test(l) && /\| +0% of/.test(l)).map((l) => l.match(/of ([\d.]+) MiB/)[1]);
  rows.push({ id, run, step: (e2e - s) / 1000, aptUpdate: (aptUpdEnd - s) / 1000, deps: (dl - s) / 1000, browser: (dlEnd - dl) / 1000, tail: (e2e - dlEnd) / 1000, job: (Date.parse(je) - Date.parse(js)) / 1000, mib: sizes.join('+') });
}
console.table(rows);
const med = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
console.log('median', Object.fromEntries(['step', 'aptUpdate', 'deps', 'browser', 'job'].map((k) => [k, med(k)])));
