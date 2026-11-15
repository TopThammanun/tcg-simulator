import type { Http } from './http';
import type { PtcgCard, TcgdexCard } from './normalize';

const TCGDEX = 'https://api.tcgdex.net/v2/en';
const PTCGIO = 'https://api.pokemontcg.io/v2';

export interface TcgdexSet {
  id: string;
  name: string;
  abbreviation?: { official?: string };
  cards: { id: string; localId: string; name: string; image?: string }[];
}

export interface TcgdexBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

// Series to scan for set codes first; the rest are only scanned if a code is still missing.
const LIKELY_SERIES = ['me', 'sv'];

export class Tcgdex {
  constructor(private http: Http) {}

  /** Every set (with its official code) in the series that could hold the wanted codes. */
  async setsForCodes(codes: Set<string>): Promise<TcgdexSet[]> {
    const series = (await this.http.getJson<{ id: string }[]>(`${TCGDEX}/series`)) ?? [];
    const order = [
      ...LIKELY_SERIES,
      ...series.map((s) => s.id).filter((id) => !LIKELY_SERIES.includes(id) && id !== 'tcgp'),
    ];
    const found: TcgdexSet[] = [];
    const missing = new Set(codes);
    for (const serieId of order) {
      if (missing.size === 0) break;
      const serie = await this.http.getJson<{ sets: { id: string }[] }>(`${TCGDEX}/series/${serieId}`);
      const sets = await Promise.all((serie?.sets ?? []).map((s) => this.set(s.id)));
      for (const set of sets) {
        if (!set) continue;
        found.push(set);
        missing.delete(set.abbreviation?.official?.toUpperCase() ?? '');
      }
    }
    return found;
  }

  set(id: string) {
    return this.http.getJson<TcgdexSet>(`${TCGDEX}/sets/${encodeURIComponent(id)}`);
  }

  card(id: string) {
    return this.http.getJson<TcgdexCard>(`${TCGDEX}/cards/${encodeURIComponent(id)}`);
  }

  /** Same-named cards from the Pokémon TCG only (TCG Pocket cards share names but not rules). */
  async byName(name: string): Promise<TcgdexBrief[]> {
    const list = await this.http.getJson<TcgdexBrief[]>(`${TCGDEX}/cards?name=eq:${encodeURIComponent(name)}`);
    return (list ?? []).filter((c) => !c.image?.includes('/tcgp/'));
  }
}

const PTCG_FIELDS = 'id,name,number,supertype,subtypes,rules,hp,abilities,attacks,weaknesses,retreatCost,images';

export class PokemonTcgIo {
  private headers: Record<string, string>;

  constructor(private http: Http, apiKey?: string) {
    this.headers = apiKey ? { 'X-Api-Key': apiKey } : {};
  }

  async sets(): Promise<{ id: string; code: string; name: string }[]> {
    const res = await this.http.getJson<{ data: { id: string; ptcgoCode?: string; name: string }[] }>(
      `${PTCGIO}/sets?pageSize=250&select=id,ptcgoCode,name`,
      { headers: this.headers },
    );
    return (res?.data ?? []).filter((s) => s.ptcgoCode).map((s) => ({ id: s.id, code: s.ptcgoCode!, name: s.name }));
  }

  /** Cards with the given numbers from one set, in a single request. */
  async cards(setId: string, numbers: string[]): Promise<PtcgCard[]> {
    const q = `set.id:${setId} (${numbers.map((n) => `number:${n}`).join(' OR ')})`;
    const url = `${PTCGIO}/cards?pageSize=250&select=${PTCG_FIELDS}&q=${encodeURIComponent(q)}`;
    const res = await this.http.getJson<{ data: PtcgCard[] }>(url, { headers: this.headers });
    return res?.data ?? [];
  }
}

export const tcgdexImage = (base: string, quality: 'high' | 'low') => `${base}/${quality}.webp`;
