import { useStore } from './store';
import { byId } from './hooks';
import { spotContributions, type SpottedContribution } from './lib/ira';

const NONE: never[] = [];
/** Meta: bank lines you said aren't IRA contributions, or matched to one you typed. */
export const IRA_REVIEWED = 'iraReviewed';

/** Bank lines that look like IRA contributions, waiting for a yes or a no. */
export function useIraSpots(): SpottedContribution[] {
  const s = useStore();
  const txns = s.raw.transactions ?? NONE;
  const accounts = s.raw.accounts ?? NONE;
  const categories = s.raw.categories ?? NONE;
  const reviewed = (s.meta?.get(IRA_REVIEWED) as string[] | undefined) ?? NONE;
  return s.derive('iraSpots', [txns, accounts, categories, reviewed, s.today], () =>
    spotContributions({ txns, accounts, categories: byId(categories), reviewed: new Set(reviewed), today: s.today }),
  );
}

/** The year you were born, if you've said (for the 50-and-older catch-up and the retirement projection). */
export const useBirthYear = () => useStore().meta?.get('birthYear') as number | undefined;

/** Your yearly pay before taxes, if you've said (for 401(k) contributions; the rent calculator shares it). */
export const usePay = () => useStore().meta?.get('grossYearly') as number | undefined;
