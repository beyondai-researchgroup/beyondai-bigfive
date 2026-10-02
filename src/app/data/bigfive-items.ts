/**
 * Big Five (OCEAN) item structure — digitized verbatim from the researcher's original
 * Google Form. All items are positively keyed (no reverse-scoring needed): every item
 * directly endorses its factor when agreed with, including the Neuroticism items, which
 * are all worded as direct endorsements of anxious/worried traits.
 *
 * NOTE: the source form has 29 items, not the 30 a clean 5-factor x 6-item design would
 * need — Conscientiousness only has 5. Unlike REI-40 this isn't a published instrument
 * with a fixed canonical item bank, so a 6th item can't be safely reconstructed from a
 * standard source; flagged for the researcher to supply or confirm rather than invented.
 *
 * Item text lives in assets/i18n/{sr,en}.json under BIGFIVE.ITEM.<id>.
 */

export type BigFiveFactor = 'O' | 'C' | 'E' | 'A' | 'N';

export interface BigFiveItem {
  id: number;
  factor: BigFiveFactor;
}

export const BIGFIVE_FACTOR_ORDER: BigFiveFactor[] = ['O', 'C', 'E', 'A', 'N'];

export const BIGFIVE_ITEMS: BigFiveItem[] = [
  // Openness to Experience (O) — 6 items
  { id: 1, factor: 'O' }, { id: 2, factor: 'O' }, { id: 3, factor: 'O' },
  { id: 4, factor: 'O' }, { id: 5, factor: 'O' }, { id: 6, factor: 'O' },
  // Conscientiousness (C) — 5 items (source form is short one item, see note above)
  { id: 7, factor: 'C' }, { id: 8, factor: 'C' }, { id: 9, factor: 'C' },
  { id: 10, factor: 'C' }, { id: 11, factor: 'C' },
  // Extraversion (E) — 6 items
  { id: 12, factor: 'E' }, { id: 13, factor: 'E' }, { id: 14, factor: 'E' },
  { id: 15, factor: 'E' }, { id: 16, factor: 'E' }, { id: 17, factor: 'E' },
  // Agreeableness (A) — 6 items
  { id: 18, factor: 'A' }, { id: 19, factor: 'A' }, { id: 20, factor: 'A' },
  { id: 21, factor: 'A' }, { id: 22, factor: 'A' }, { id: 23, factor: 'A' },
  // Neuroticism (N) — 6 items
  { id: 24, factor: 'N' }, { id: 25, factor: 'N' }, { id: 26, factor: 'N' },
  { id: 27, factor: 'N' }, { id: 28, factor: 'N' }, { id: 29, factor: 'N' },
];

export interface BigFiveScores {
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
}

/** Computes the 5 factor averages (1-5 scale) from raw per-item answers. */
export function computeBigFiveScores(answers: Record<number, number>): BigFiveScores {
  const byFactor: Record<BigFiveFactor, number[]> = { O: [], C: [], E: [], A: [], N: [] };
  for (const item of BIGFIVE_ITEMS) {
    byFactor[item.factor].push(answers[item.id]);
  }
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return { O: avg(byFactor.O), C: avg(byFactor.C), E: avg(byFactor.E), A: avg(byFactor.A), N: avg(byFactor.N) };
}