// scripts/probe-p15.3.ts — регресійний probe П15.3 (ADR-0075).
// У git з Т.6b (2026-11-10). Під час П15.3 файл був untracked: він виживає під
// `git stash`, тож той самий скрипт виконувався на гілці та на стані ≡ main —
// порівняння байт-у-байт (docs/reports/p15.3-probe.md).
// Запуск: npx vite-node scripts/probe-p15.3.ts --out dist/probe-branch.json
// Методика: simulateParty (сіди × 3 пресети, повний горизонт 30 діб) +
// дзеркальний replay циклу simulateParty (party-bot.ts) з інлайновим кроком
// місії — доступ до бойових логів для формальної перевірки «жодного evac_unit»;
// serializeParty кінцевого стану як повний знімок партії.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_PARTY_POLICY,
  TICKS_PER_DAY,
  partyBotHireStep,
  partyBotInterceptStep,
  partyBotScienceStep,
  simulateParty,
} from '../src/core/party-bot';
import { createParty, serializeParty, type Party } from '../src/core/save';
import { advanceTime, missionTargets } from '../src/core/geo';
import { creditMissionBonus, economyTick } from '../src/core/economy';
import { applyMissionResult, hospitalTick, isBankrupt, missionSquad, readySoldiers } from '../src/core/squad';
import { interceptTick, repairTick } from '../src/core/intercept';
import { researchTick } from '../src/core/research';
import { deployConsumables, removeLostEquipment, settleConsumables, workshopTick } from '../src/core/workshop';
import { campaignTick, VICTORY_DAY, type DifficultyPreset } from '../src/core/campaign';
import { autoBattle } from '../src/core/ai-bot';
import { completeMission, createMission } from '../src/core/mission';

const PRESETS: DifficultyPreset[] = ['легкий', 'норма', 'складний'];
const SEEDS = [1, 2, 3, 42, 45, 7]; // 6 сідів × 3 пресети, повний горизонт

function parseOut(): string {
  const i = process.argv.indexOf('--out');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'dist/probe.json';
}

// Дзеркало partyBotMissionStep (party-bot.ts) з розкриттям бойового стану:
// лог бою місії перевіряється на evac_unit до звичайного розрахунку.
function missionStep(party: Party): { evacUnits: number } {
  const policy = DEFAULT_PARTY_POLICY;
  let evacUnits = 0;
  if (!policy.missions) return { evacUnits };
  if (readySoldiers(party.roster).length < policy.missionSquadSize) return { evacUnits };
  const target = missionTargets(party.geo)[0];
  if (!target) return { evacUnits };
  const squad = missionSquad(party.roster, policy.missionSquadSize);
  const consumables = deployConsumables(party.workshop, squad);
  const hasItems = Object.keys(consumables).length > 0;
  const mission = createMission(party.geo, target.id, hasItems ? { squad, items: consumables } : { squad });
  const battle = autoBattle(mission.state);
  const outcome: 'перемога' | 'поразка' = battle.outcome === 'перемога' ? 'перемога' : 'поразка';
  completeMission(party.geo, mission.briefing.ufoId, outcome);
  const aftermath = applyMissionResult(party.roster, mission.state);
  removeLostEquipment(party.workshop, aftermath.lost);
  settleConsumables(party.workshop, aftermath.survivors, mission.state.items);
  if (outcome === 'перемога') creditMissionBonus(party.econ, mission.briefing.kind, party.campaign.preset);
  evacUnits += mission.state.log.filter((e) => e.type === 'evac_unit').length;
  return { evacUnits };
}

// Дзеркало циклу simulateParty (party-bot.ts, фази 1–5 у тому самому порядку).
function replay(seed: number, preset: DifficultyPreset): { save: string; evacUnits: number; evacMissions: number } {
  const policy = DEFAULT_PARTY_POLICY;
  const party = createParty(seed, preset);
  let evacUnits = 0;
  for (let t = 0; t < VICTORY_DAY * TICKS_PER_DAY; t++) {
    partyBotInterceptStep(party, policy.intercept);
    interceptTick(party.intercept, party.geo);
    repairTick(party.intercept, party.geo);
    advanceTime(party.geo, 1);
    economyTick(party.econ, party.geo, party.campaign.preset);
    researchTick(party.research, party.econ, party.geo, party.campaign.preset);
    workshopTick(party.workshop);
    hospitalTick(party.roster);
    partyBotHireStep(party, policy);
    partyBotScienceStep(party, policy);
    evacUnits += missionStep(party).evacUnits;
    if (isBankrupt(party.econ, party.roster, party.campaign.preset)) break;
    campaignTick({ geo: party.geo, roster: party.roster, econ: party.econ }, party.campaign);
    if (party.campaign.status === 'перемога') break;
  }
  const evacMissions = party.geo.log.filter((e) => e.type === 'mission_evacuated').length;
  return { save: serializeParty(party, 'probe'), evacUnits, evacMissions };
}

interface Snapshot {
  seed: number;
  preset: DifficultyPreset;
  sim: string; // JSON.stringify(simulateParty(...)) — траєкторія метрик
  save: string; // serializeParty кінцевого стану replay
  evacUnits: number; // evac_unit у бойових логах усіх місій replay
  evacMissions: number; // mission_evacuated у журналі геосцени replay
}

const out: Snapshot[] = [];
for (const preset of PRESETS) {
  for (const seed of SEEDS) {
    const sim = JSON.stringify(simulateParty(seed, preset));
    const rep = replay(seed, preset);
    out.push({ seed, preset, sim, save: rep.save, evacUnits: rep.evacUnits, evacMissions: rep.evacMissions });
    process.stderr.write(`seed ${seed} ${preset}: evacUnits=${rep.evacUnits} evacMissions=${rep.evacMissions}\n`);
  }
}

const path = parseOut();
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(out), 'utf8');
const totalEvac = out.reduce((a, s) => a + s.evacUnits + s.evacMissions, 0);
console.log(`Партій: ${out.length}; evac_unit + mission_evacuated у всіх логах: ${totalEvac}`);
console.log(`Знімок: ${path}`);
