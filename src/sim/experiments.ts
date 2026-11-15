// Strategies/lists for your deck and the first experiments from PLAN.md ("การทดลองชุดแรก").
import { DEFAULT_POLICY, type PlayerPolicy } from '../bots/plans/basic-box';

export interface DeckEdit {
  add: string[];
  remove: string[];
}

export interface PlayerConfig {
  label: string;
  policy: PlayerPolicy;
  edit?: DeckEdit;
}

export interface Experiment {
  id: string;
  title: string;
  a: PlayerConfig;
  b: PlayerConfig;
}

const base = (label: string, policy: Partial<PlayerPolicy> = {}, edit?: DeckEdit): PlayerConfig => ({
  label,
  policy: { ...DEFAULT_POLICY, ...policy },
  edit,
});

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'area-zero',
    title: 'Area Zero: เก็บไว้ทับ Grounds vs ลงตั้งแต่แรก',
    a: base('เก็บไว้ทับ Grounds', { areaZero: 'hold' }),
    b: base('ลงตั้งแต่แรก', { areaZero: 'early' }),
  },
  {
    id: 'fire-for-grass',
    title: 'list เดิม vs +1 Fire Energy −1 Grass Energy',
    a: base('list เดิม'),
    b: base('+1 Fire −1 Grass', {}, { add: ['fire-energy'], remove: ['grass-energy'] }),
  },
  {
    id: 'tauros-for-clefairy',
    title: "list เดิม vs −1 Lillie's Clefairy ex +1 Paldean Tauros",
    a: base('list เดิม'),
    b: base("−1 Lillie's Clefairy ex +1 Paldean Tauros", {}, { add: ['paldean-tauros'], remove: ['lillies-clefairy-ex'] }),
  },
  {
    id: 'cape-wall',
    title: "Kangaskhan + Hero's Cape เป็นกำแพง vs ไม่ใช้",
    a: base('ใช้กำแพง', { capeWall: true }),
    b: base('ไม่ใช้กำแพง', { capeWall: false }),
  },
  {
    id: 'bench-max',
    title: 'Bench สูงสุด 5 vs 8',
    a: base('Bench 5', { benchMax: 5 }),
    b: base('Bench 8', { benchMax: 8 }),
  },
];

export function applyEdit(cards: string[], edit?: DeckEdit): string[] {
  if (!edit) return cards;
  const out = cards.slice();
  for (const k of edit.remove) {
    const i = out.indexOf(k);
    if (i < 0) throw new Error(`deck has no ${k} to remove`);
    out.splice(i, 1);
  }
  out.push(...edit.add);
  return out;
}
