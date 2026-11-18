// The card feature table for PyTorch (the v2 network, ml/common.py Net2): the engine's card keys in the
// encoder's order, each card's printed features (src/bots/learn/card-features.ts), and the globals v2 reads.
//   npx tsx scripts/learn/features.ts <out.json>
import { writeFileSync } from 'node:fs';
import { CARD_F, featureTable } from '../../src/bots/learn/card-features';
import { CARD_KEYS } from '../../src/bots/learn/encode';
import { GLOB_KEEP } from '../../src/bots/learn/model';

const table = featureTable(CARD_KEYS);
writeFileSync(process.argv[2]!, JSON.stringify({ cards: CARD_KEYS, F: CARD_F, table: Array.from(table), globKeep: Array.from(GLOB_KEEP) }));
