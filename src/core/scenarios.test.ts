// Т.218: сценарії для перевірки — кожна віха досягається з фіксованого сіду, сейв розбирається,
// стан після завантаження — та сама віха; збірка детермінована (ADR-0003).
import { describe, expect, it } from 'vitest';
import { geoDay } from './geo';
import { serializeParty } from './save';
import { createAssault } from './assault';
import { readySoldiers } from './squad';
import { SCENARIOS, buildScenarioSave, landedKinds, scenarioParty, scenarioSave, type ScenarioId } from './scenarios';

describe('Т.218: сценарії для перевірки (SCENARIOS)', () => {
  it('сім віх з унікальними id, назвою й описом', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['kinds', 'arsenal', 'assault', 'gate', 'gate-retry', 'edge', 'fleet']);
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.desc.length).toBeGreaterThan(0);
    }
  });

  // доба в описі — з факту збірки (скан Т.218), щоб опис не розійшовся з правилами
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s: віха справджується в завантаженій партії, доба — як в описі', (_id, s) => {
    const p = scenarioParty(s.id);
    expect(s.until(p)).toBe(true);
    expect(p.campaign.status).toBe('триває');
    expect(s.desc).toContain(`(${geoDay(p.geo)}-`);
  });

  it('детерміновано: два виклики — той самий сейв; сейв — повна партія (серіалізація назад — той самий рядок)', () => {
    const a = scenarioSave('gate');
    expect(scenarioSave('gate')).toBe(a);
    expect(serializeParty(scenarioParty('gate'))).toBe(a);
  });

  it('аудит PR #535: «Нові типи ворогів» — у місії справді три типи з големом і оком; «Штурм бази» — усі чотири на полі', () => {
    const k = landedKinds(scenarioParty('kinds'));
    expect(k.some((s) => s.size === 3 && s.has('golem') && s.has('eye'))).toBe(true);
    const p = scenarioParty('assault');
    const storm = createAssault(p, { squad: readySoldiers(p.roster).slice(0, 3) });
    expect(new Set(storm.state.units.filter((u) => u.side === 'alien').map((u) => u.kind ?? 'demon')).size).toBe(4);
  });

  it('невідомий сценарій — помилка українською', () => {
    expect(() => scenarioSave('казус' as ScenarioId)).toThrow('Невідомий сценарій: казус');
  });

  it('віхи немає до горизонту (зміна правил чи бота) — помилка з назвою сценарію', () => {
    const never = { ...SCENARIOS[0], title: 'Ніколи', until: () => false };
    expect(() => buildScenarioSave(never)).toThrow('Сценарій «Ніколи»: віхи не досягнуто за 60 діб');
  });
});
