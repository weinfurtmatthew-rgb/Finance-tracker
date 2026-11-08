/** Stocks, ETFs and funds in your investment accounts, worked out once from the store (see store.tsx). */
import { useStore } from './store';
import type { PriceHistory } from './lib/prices';
import type { Security, Trade } from './types';
import { buildAllHoldings, type Holdings } from './lib/holdings';
import { buildPortfolio, type Portfolio } from './lib/portfolio';
import { portfolioInsights, type Insight } from './lib/insights';
import { TARGET_MIX } from './lib/mix';

const EMPTY: never[] = [];

/** Per investment account with trades: its holdings and cash. */
export function useHoldings(): Map<string, Holdings> {
  const s = useStore();
  const accounts = s.raw.accounts ?? EMPTY;
  const trades = s.raw.trades ?? EMPTY;
  const securities = s.raw.securities ?? EMPTY;
  const prices = s.raw.priceCache ?? EMPTY;
  return s.derive('holdings', [accounts, trades, securities, prices], () => buildAllHoldings(accounts, trades, prices, securities));
}

export const useTrades = (): Trade[] => useStore().raw.trades ?? EMPTY;

export function useSecurities(): Map<string, Security> {
  const s = useStore();
  const list = s.raw.securities ?? EMPTY;
  return s.derive('securities', [list], () => new Map(list.map((x) => [x.ticker, x])));
}

export function usePrices(): Map<string, PriceHistory> {
  const s = useStore();
  const list = s.raw.priceCache ?? EMPTY;
  return s.derive('prices', [list], () => new Map(list.map((x) => [x.ticker, x])));
}

/** Every investment account with holdings, together (null without any). */
export function usePortfolio(): Portfolio | null {
  const s = useStore();
  const holdings = useHoldings();
  return s.derive('portfolio', [holdings, s.today], () => buildPortfolio([...holdings.values()], s.today));
}

/** "Worth a look": facts about your investments, the most pressing first (lib/insights.ts). */
export function useInsights(): Insight[] {
  const s = useStore();
  const p = usePortfolio();
  const securities = useSecurities();
  const accounts = s.raw.accounts ?? EMPTY;
  const hasTarget = s.meta?.get(TARGET_MIX) != null;
  return s.derive('insights', [p, accounts, securities, hasTarget, s.today], () =>
    p ? portfolioInsights({ p, accounts, securities, hasTarget, today: s.today }) : [],
  );
}
