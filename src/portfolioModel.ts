/** Stocks, ETFs and funds in your investment accounts, worked out once from the store (see store.tsx). */
import { useStore } from './store';
import type { PriceHistory } from './lib/prices';
import type { Security, Trade } from './types';
import { buildAllHoldings, type Holdings } from './lib/holdings';

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
