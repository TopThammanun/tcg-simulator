// The major finals prepared for transcribing (BOT-PRO.md P0): data/pro/matches.json names each final by event and
// placings; the lists come from data/pro/majors.json (scripts/pro/majors.ts). Read at build time by /transcribe/.
import majorsJson from '../../data/pro/majors.json';
import matchesJson from '../../data/pro/matches.json';
import type { ProMeta } from '../review/record';
import type { PreparedMatch } from '../ui/transcribe';

interface MajorList {
  placing: number;
  player: string;
  deck: string;
  text: string;
  missing: string[];
}
interface MajorEvent {
  id: number;
  name: string;
  lists: MajorList[];
}
interface MatchSpec {
  id: string;
  event: number;
  round: string;
  placings: [number, number];
  video: string;
  source: ProMeta['source'];
  games?: number[];
}

/** Every prepared final whose two lists the engine can play. */
export function preparedMatches(): PreparedMatch[] {
  const events = (majorsJson as unknown as { events: MajorEvent[] }).events;
  return (matchesJson as unknown as { matches: MatchSpec[] }).matches.flatMap((m) => {
    const e = events.find((x) => x.id === m.event);
    const seats = m.placings.map((p) => e?.lists.find((l) => l.placing === p));
    if (!e || seats.some((l) => !l || l.missing.length)) return [];
    const [a, b] = seats as [MajorList, MajorList];
    return [
      {
        id: m.id,
        label: `${e.name} · ${m.round}: ${a.player} (${a.deck}) vs ${b.player} (${b.deck})`,
        event: e.name,
        round: m.round,
        players: [a.player, b.player],
        lists: [a.text, b.text],
        video: m.video,
        source: m.source,
        ...(m.games ? { games: m.games } : {}),
      },
    ];
  });
}
