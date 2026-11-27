// src/core/scenarios.ts
// Т.218 (відгук власника 27.11.2026: «тестувати полний цикл гри нереально, чи можна роботи спеціальні
// сейви, щоб відразу перевірить якісь кінцеві елементи»; рішення «7 віх, кнопка на старті»): сценарії
// для перевірки — бот партії кампанії (`CAMPAIGN_POLICY`) грає з фіксованого сіду до віхи і зупиняється
// перед своїм ходом (`simulateParty` з `until`). Партію збирають у мить вибору (≈ 0,05–0,35 с), а не
// зберігають готовим сейвом: формат і правила завжди поточні, нічого не старіє зі зміною версії сейва.
// Детерміновано (ADR-0003): той самий сід і код — той самий стан.
import { gateOpen } from './assault';
import type { DifficultyPreset } from './campaign';
import type { EnemyKind } from './enemies';
import { missionTargets } from './geo';
import { createMission } from './mission';
import { CAMPAIGN_POLICY, simulateParty } from './party-bot';
import { deserializeParty, serializeParty, type Party } from './save';

export type ScenarioId = 'kinds' | 'arsenal' | 'assault' | 'gate' | 'gate-retry' | 'edge' | 'fleet';

export interface Scenario {
  id: ScenarioId;
  title: string;
  desc: string;
  seed: number;
  preset: DifficultyPreset;
  until: (p: Readonly<Party>) => boolean;
}

// Межа загрози, з якої склад місії бере всі чотири типи ворогів (`kindsForThreat`, ADR-0155: 8 / 17 / 27).
const ALL_KINDS_THREAT = 27;
const EDGE_THREAT = 90;
const FORGE_PROTOCOLS = ['shotgun', 'mg', 'sniper'] as const;
const landed = (p: Readonly<Party>): boolean => missionTargets(p.geo).length > 0;
// Типи ворогів місії кожного приземленого зонда — склад, як у бою (`createMission` geo не змінює).
// Місія — 2–3 ворогів (`ALIENS_PER_KIND`), тож усі чотири типи разом — лише в штурмі й Брамі.
export function landedKinds(p: Readonly<Party>): Set<EnemyKind>[] {
  return missionTargets(p.geo).map(
    (u) =>
      new Set(
        createMission(p.geo, u.id, { threat: p.campaign.threat })
          .state.units.filter((x) => x.side === 'alien')
          .map((x) => x.kind ?? 'demon')
      )
  );
}

// Сіди й доби — скан сідів 1–30 на «нормі» (Т.218); доба — коли бот доходить до віхи.
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'kinds',
    title: 'Нові типи ворогів',
    desc: 'Зонд приземлився: у місії три різні типи, серед них голем і око; усі чотири разом — у «Штурмі бази» і «Перед Брамою» (22-га доба)',
    seed: 6,
    preset: 'норма',
    until: (p) => p.campaign.threat >= ALL_KINDS_THREAT && landedKinds(p).some((k) => k.size === 3 && k.has('golem') && k.has('eye')),
  },
  {
    id: 'arsenal',
    title: 'Повний арсенал',
    desc: 'Протоколи «Шквалу», «Града» і «Голки» завершено, зонд приземлився — вікно спорядження (27-ма доба)',
    seed: 3,
    preset: 'норма',
    until: (p) => FORGE_PROTOCOLS.every((id) => p.research.completed.includes(id)) && landed(p),
  },
  {
    id: 'assault',
    title: 'Штурм бази',
    desc: 'Загроза дійшла до порогу — штурм почнеться з першим рухом часу; на полі — усі чотири типи ворогів (28-ма доба)',
    seed: 9,
    preset: 'норма',
    until: (p) => p.campaign.assaultPending === true,
  },
  {
    id: 'gate',
    title: 'Перед Брамою',
    desc: '«Ключ брами» завершено — фінальна місія доступна вперше (41-ша доба)',
    seed: 5,
    preset: 'норма',
    until: (p) => gateOpen(p),
  },
  {
    id: 'gate-retry',
    title: 'За крок до перемоги',
    desc: 'Перша спроба Брами програна, друга доступна — бот на ній перемагає (42-га доба)',
    seed: 7,
    preset: 'норма',
    until: (p) => gateOpen(p) && p.campaign.gateReadyAt !== undefined,
  },
  {
    id: 'edge',
    title: 'На межі поразки',
    desc: 'Загроза 90+: третій штурм бази почнеться з першим рухом часу; на 100 — поразка (42-га доба)',
    seed: 2,
    preset: 'норма',
    until: (p) => p.campaign.threat >= EDGE_THREAT,
  },
  {
    id: 'fleet',
    title: 'Два перехоплювачі, район на межі',
    desc: 'Другий перехоплювач куплено; довіра району 30 чи менше — ще один пропущений виявлений зонд (−30), і район вийде (23-тя доба)',
    seed: 8,
    preset: 'норма',
    until: (p) => p.intercept.fighters.length >= 2 && Object.values(p.campaign.regions).some((r) => !r.out && r.trust > 0 && r.trust <= 30),
  },
];

// Горизонт пошуку віхи: усі віхи — до 50-ї доби; далі — помилка (віху зламала зміна правил чи бота).
const SCENARIO_MAX_DAYS = 60;

// Сейв (рядок формату ADR-0026) партії сценарію; немає віхи до горизонту — помилка українською.
export function scenarioSave(id: ScenarioId): string {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (sc === undefined) throw new Error('Невідомий сценарій: ' + id);
  return buildScenarioSave(sc);
}

// Збірка сейва за описом сценарію (окремо — для тесту віхи, якої немає).
export function buildScenarioSave(sc: Scenario): string {
  let found: Readonly<Party> | null = null;
  simulateParty(sc.seed, sc.preset, {
    policy: CAMPAIGN_POLICY,
    maxDays: SCENARIO_MAX_DAYS,
    until: (p) => {
      if (!sc.until(p)) return false;
      found = p;
      return true;
    },
  });
  if (found === null) throw new Error(`Сценарій «${sc.title}»: віхи не досягнуто за ${SCENARIO_MAX_DAYS} діб`);
  return serializeParty(found as Party);
}

// Партія сценарію — через сейв: стан той самий, що після «Завантажити».
export function scenarioParty(id: ScenarioId): Party {
  return deserializeParty(scenarioSave(id));
}
