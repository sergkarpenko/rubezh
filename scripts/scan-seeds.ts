// scripts/scan-seeds.ts — скан сідів повних партій бота (кандидат процесу 203, Т.218): для кожного сіду —
// результат, доба кінця, загиблі, банкрутство; з `--until <віха>` — доба, коли бот доходить до віхи
// сценаріїв перевірки (src/core/scenarios.ts, ADR-0172). Для підбору фіксованих сідів тестів і віх.
//   node scripts/run-ts.mjs scripts/scan-seeds.ts -- --seeds 1-30 --preset норма --policy campaign
//   node scripts/run-ts.mjs scripts/scan-seeds.ts -- --seeds 1-30 --until gate
// Детерміновано (ADR-0003); ≈ 0,1–0,3 с на партію.
import type { DifficultyPreset } from '../src/core/campaign';
import { geoDay } from '../src/core/geo';
import { CAMPAIGN_POLICY, DEFAULT_PARTY_POLICY, SCIENCE_POLICY, simulateParty, type PartyBotPolicy } from '../src/core/party-bot';
import { SCENARIOS } from '../src/core/scenarios';

const i0 = process.argv.indexOf('--');
const args = i0 < 0 ? [] : process.argv.slice(i0 + 1);
const arg = (name: string, d: string): string => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const [from, to] = arg('seeds', '1-30').split('-').map(Number);
const preset = arg('preset', 'норма') as DifficultyPreset;
const policies: Record<string, PartyBotPolicy> = { campaign: CAMPAIGN_POLICY, default: DEFAULT_PARTY_POLICY, science: SCIENCE_POLICY };
const policy = policies[arg('policy', 'campaign')];
if (policy === undefined || !Number.isInteger(from) || !Number.isInteger(to ?? from)) {
  console.error('Використання: scan-seeds.ts -- [--seeds A-B] [--preset норма] [--policy campaign|default|science] [--until <id віхи>]');
  process.exit(2);
}
const untilId = arg('until', '');
const sc = SCENARIOS.find((s) => s.id === untilId);
if (untilId !== '' && sc === undefined) {
  console.error('Невідома віха: ' + untilId + ' (є: ' + SCENARIOS.map((s) => s.id).join(', ') + ')');
  process.exit(2);
}
console.log(sc ? '| сід | доба віхи |' : '| сід | результат | доба | загиблих | місій |');
console.log(sc ? '| --- | --- |' : '| --- | --- | --- | --- | --- |');
for (let seed = from; seed <= (to ?? from); seed++) {
  if (sc) {
    let day = '—';
    simulateParty(seed, preset, {
      policy,
      maxDays: 60,
      until: (p) => {
        const ok = sc.until(p);
        if (ok) day = String(geoDay(p.geo));
        return ok;
      },
    });
    console.log(`| ${seed} | ${day} |`);
  } else {
    const r = simulateParty(seed, preset, { policy });
    console.log(`| ${seed} | ${r.outcome} | ${r.endDay} | ${r.soldiersLost} | ${r.missionsLaunched} |`);
  }
}
