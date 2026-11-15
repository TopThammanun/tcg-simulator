// Drag and drop on the play screen: which zones accept a dragged card or Pokémon, and what each drop does.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import type { ChoiceRequest } from '../../src/engine/types';
import { handDrops, pickDrop, setupDrops, slotDrops } from '../../src/ui/drag';
import { describeAction, handActions } from '../../src/ui/play';
import { active, bench, handCard, scenario } from '../engine/helpers';

const board = () =>
  scenario({
    p0: {
      active: { card: 'teal-mask-ogerpon-ex', energy: ['grass-energy'] },
      bench: ['mega-kangaskhan-ex', 'latias-ex'],
      hand: ['grass-energy', 'meowth-ex', 'ultra-ball', 'fire-energy', 'judge'],
    },
    p1: { active: 'dreepy' },
  });

describe('dragging a card from your hand', () => {
  it('drops Energy on any of your Pokémon and attaches it there', () => {
    const s = board();
    const card = handCard(s, 0, 'grass-energy');
    const drops = handDrops(handActions(s).get(card));
    const uids = [active(s, 0).uid, bench(s, 0, 0).uid, bench(s, 0, 1).uid];
    expect([...drops.keys()].sort()).toEqual(uids.map((u) => `slot:${u}`).sort());
    const onLatias = drops.get(`slot:${bench(s, 0, 1).uid}`)!;
    expect(onLatias).toEqual({ t: 'energy', card, target: bench(s, 0, 1).uid });
    expect(apply(s, onLatias).players[0].bench[1]!.energy).toHaveLength(1);
  });

  it('drops a Basic Pokémon on the Bench (or anywhere on the board)', () => {
    const s = board();
    const card = handCard(s, 0, 'meowth-ex');
    const drops = handDrops(handActions(s).get(card));
    expect([...drops.keys()]).toEqual(['bench', 'play']);
    expect(drops.get('bench')).toEqual({ t: 'bench', card });
    expect(drops.get('play')).toEqual({ t: 'bench', card });
  });

  it('drops an Item or Supporter anywhere on the board to play it', () => {
    const s = board();
    for (const key of ['ultra-ball', 'judge']) {
      const card = handCard(s, 0, key);
      const drops = handDrops(handActions(s).get(card));
      expect([...drops.keys()]).toEqual(['play']);
      expect(drops.get('play')).toEqual({ t: 'trainer', card });
    }
  });

  it('has nowhere to drop a card that cannot be played', () => {
    expect(handDrops(undefined).size).toBe(0);
  });
});

describe('dragging one of your Pokémon', () => {
  it('drags the Active onto a Benched Pokémon to retreat to it', () => {
    const s = board();
    const drops = slotDrops(s, legalActions(s), active(s, 0).uid);
    const latias = bench(s, 0, 1).uid;
    expect(drops.get(`slot:${latias}`)).toEqual({ t: 'retreat', to: latias });
    expect(drops.size).toBe(2);
  });

  it('drags a Benched Pokémon onto the Active to bring it up', () => {
    const s = board();
    const kanga = bench(s, 0, 0).uid;
    const drops = slotDrops(s, legalActions(s), kanga);
    expect([...drops.keys()]).toEqual([`slot:${active(s, 0).uid}`, 'active']);
    expect(drops.get('active')).toEqual({ t: 'retreat', to: kanga });
  });

  it('cannot drag when retreating is not possible', () => {
    // (No Latias ex: Skyliner makes retreating free.)
    const s = scenario({ p0: { active: 'teal-mask-ogerpon-ex', bench: ['mega-kangaskhan-ex'] }, p1: { active: 'dreepy' } });
    expect(slotDrops(s, legalActions(s), active(s, 0).uid).size).toBe(0);
    expect(slotDrops(s, legalActions(s), bench(s, 0, 0).uid).size).toBe(0);
  });
});

describe('setup by dragging', () => {
  const req = (purpose: ChoiceRequest['purpose']): ChoiceRequest => ({
    player: 0,
    purpose,
    prompt: '',
    options: [
      { value: 7, label: 'A', card: 7 },
      { value: 9, label: 'B', card: 9 },
    ],
    min: 0,
    max: 5,
  });

  it('drops a Basic on the Active Spot while choosing the Active', () => {
    expect(setupDrops(req('setup-active'), 9)).toEqual(new Map([['active', 9]]));
  });

  it('drops Basics on the Bench while choosing the Bench', () => {
    expect(setupDrops(req('setup-bench'), 7)).toEqual(new Map([['bench', 7]]));
  });

  it('ignores cards that are not options and other choices', () => {
    expect(setupDrops(req('setup-bench'), 8).size).toBe(0);
    expect(setupDrops(req('discard'), 7).size).toBe(0);
    expect(setupDrops(null, 7).size).toBe(0);
  });
});

describe('pickDrop', () => {
  const drops = new Map<string, number>([
    ['slot:4', 1],
    ['play', 2],
  ]);
  it('takes the innermost zone under the pointer that accepts the drop', () => {
    expect(pickDrop(['slot:4', 'bench', 'play'], drops)).toBe('slot:4');
    expect(pickDrop(['slot:5', 'bench', 'play'], drops)).toBe('play');
    expect(pickDrop(['bench'], drops)).toBeNull();
  });
});

describe('describeAction', () => {
  it('names the card and the Pokémon it goes to', () => {
    const s = board();
    const latias = bench(s, 0, 1).uid;
    expect(describeAction(s, { t: 'energy', card: handCard(s, 0, 'grass-energy'), target: latias })).toBe(
      'ติด Grass Energy ให้ Latias ex',
    );
    expect(describeAction(s, { t: 'retreat', to: latias })).toBe('ถอย Teal Mask Ogerpon ex ให้ Latias ex ขึ้นมาแทน');
    expect(describeAction(s, { t: 'bench', card: handCard(s, 0, 'meowth-ex') })).toBe('ลง Meowth ex บน Bench');
    expect(describeAction(s, { t: 'trainer', card: handCard(s, 0, 'judge') })).toBe('ใช้ Judge');
  });
});
