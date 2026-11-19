import { describe, expect, it } from 'vitest';
import { formatDecklist, parseDecklist } from '../../src/data/decklist';
import { checkList } from '../../src/ui/decklist';
import { loadDeckFiles } from '../../scripts/lib/decks';

const player = loadDeckFiles('src/content/decks').find((d) => d.slug === 'player')!;
const text = formatDecklist(player.list.entries);

describe('formatDecklist', () => {
  it('round-trips through parseDecklist', () => {
    expect(parseDecklist(text).entries).toEqual(player.list.entries);
  });
});

describe('checkList', () => {
  it('accepts your list and returns 60 card keys', () => {
    const r = checkList(text);
    expect(r.errors).toEqual([]);
    expect(r.cards).toHaveLength(60);
  });

  it('matches another print of a supported card by name', () => {
    const r = checkList(text.replace("2 Boss's Orders ASC 183", "2 Boss's Orders PAL 172"));
    expect(r.errors).toEqual([]);
    expect(r.cards!.filter((k) => k === 'bosss-orders')).toHaveLength(2);
  });

  it('rejects cards the simulator does not support', () => {
    const r = checkList(text.replace('1 Judge POR 76', '1 Iono PAL 185'));
    expect(r.errors.join(' ')).toMatch(/Iono/);
  });

  it('rejects more than 4 copies and a second ACE SPEC', () => {
    const r = checkList(text.replace('4 Crispin PRE 105', '5 Crispin PRE 105').replace('1 Glass Trumpet ASC 189', '1 Secret Box TWM 163').replace('2 Night Stretcher ASC 196', '1 Night Stretcher ASC 196'));
    expect(r.errors.join(' ')).toMatch(/Crispin/);
    expect(r.errors.join(' ')).toMatch(/ACE SPEC/);
  });

  it('reports a list that does not have 60 cards', () => {
    expect(checkList(text.replace('4 Crispin PRE 105', '3 Crispin PRE 105')).errors.join(' ')).toMatch(/60/);
  });
});

describe('checkList for pasted lists', () => {
  it('reads a list without section headings', () => {
    const bare = text
      .split('\n')
      .filter((l) => /^\d/.test(l))
      .join('\n');
    expect(checkList(bare).cards).toHaveLength(60);
  });

  it('names every card it does not support, and says so in Thai', () => {
    const r = checkList(text.replace('1 Judge POR 76', '1 Iono PAL 185').replace('1 Hero\'s Cape TEF 152', '1 Charizard ex OBF 125'));
    expect(r.unsupported).toEqual(['Iono', 'Charizard ex']);
    expect(r.errors.join(' ')).toMatch(/ยังไม่รองรับ/);
    expect(checkList('Pokémon\nfour Dreepy').errors[0]).toMatch(/^บรรทัด 2 อ่านไม่ออก/);
    expect(checkList('4 Dreepy TWM 128').errors[0]).toMatch(/มี 4 ใบ \(ต้องมี 60 ใบ\)/);
  });
});
