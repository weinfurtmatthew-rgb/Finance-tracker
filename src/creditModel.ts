import { useStore } from './store';
import { setMeta } from './db';
import { CREDIT_GOAL, CREDIT_SCORES, byDate, type CreditGoal, type CreditScore } from './lib/credit';

const NONE: CreditScore[] = [];

/** Your credit score log, oldest first. */
export function useCreditScores(): CreditScore[] {
  const s = useStore();
  const raw = (s.meta?.get(CREDIT_SCORES) as CreditScore[] | undefined) ?? NONE;
  return s.derive('creditScores', [raw], () => byDate(raw));
}

/** Your score goal, if you've set one. */
export const useCreditGoal = () => useStore().meta?.get(CREDIT_GOAL) as CreditGoal | undefined;

/** Adds a score, or replaces the one with the same id. */
export const saveScore = (entry: CreditScore, all: CreditScore[]) => setMeta(CREDIT_SCORES, byDate([...all.filter((x) => x.id !== entry.id), entry]));

export const deleteScore = (id: string, all: CreditScore[]) =>
  setMeta(
    CREDIT_SCORES,
    all.filter((x) => x.id !== id),
  );
