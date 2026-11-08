/**
 * What your investments are made of: by kind (US and international stocks, bonds, real estate, cash), by
 * holding and by sector, where that's concentrated, and how far it is from a mix you aim for.
 *
 * The price service's free plan doesn't say what a fund holds or a company's sector, so popular ones are
 * known here; you can set any of them on a holding's page.
 */
import type { Cents, Security } from '../types';
import { cashOn } from './holdings';
import type { Portfolio } from './portfolio';

export type AssetKind = 'us' | 'intl' | 'bonds' | 'realestate' | 'cash' | 'other';

/** In this order everywhere. */
export const KINDS: { value: AssetKind; label: string }[] = [
  { value: 'us', label: 'US stocks' },
  { value: 'intl', label: 'International stocks' },
  { value: 'bonds', label: 'Bonds' },
  { value: 'realestate', label: 'Real estate' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];
export const kindLabel = (k: AssetKind) => KINDS.find((x) => x.value === k)!.label;

export const SECTORS = [
  'Technology',
  'Health care',
  'Financials',
  'Consumer discretionary',
  'Communication',
  'Industrials',
  'Consumer staples',
  'Energy',
  'Utilities',
  'Real estate',
  'Materials',
] as const;
export type Sector = (typeof SECTORS)[number];

const each = <T>(list: string, value: T): Record<string, T> => Object.fromEntries(list.split(' ').map((t) => [t, value]));

/** Popular funds, by what they hold. */
const FUNDS: Record<string, AssetKind> = {
  ...each(
    'VTI VOO SPY IVV QQQ QQQM SCHB SCHX SCHD SCHG ITOT VUG VTV VB VO VIG VYM VV MGK IWM IWF IWD IJH IJR RSP SPLG DIA VGT XLK SMH JEPI JEPQ DGRO NOBL MTUM USMV ' +
      'FXAIX FSKAX FZROX FNILX FCNTX VFIAX VTSAX VFINX VTSMX VIGAX VIMAX VSMAX SWPPX SWTSX',
    'us' as const,
  ),
  ...each('VXUS VEA VWO IXUS IEFA IEMG EFA EEM SCHF SCHE VEU SPDW VTIAX VTMGX VEMAX FTIHX FZILX FSPSX SWISX', 'intl' as const),
  ...each('BND AGG BNDX SCHZ TLT IEF SHY VGIT VGSH VGLT BSV BIV BLV VTIP TIP SCHP LQD HYG JNK MUB VTEB SGOV BIL SHV VBTLX VBMFX FXNAX SWAGX', 'bonds' as const),
  ...each('VNQ VNQI SCHH XLRE IYR VGSLX FSRNX', 'realestate' as const),
  ...each('SPAXX FDRXX FZFXX VMFXX VUSXX SWVXX', 'cash' as const),
};

/** Popular companies' sectors. */
const STOCKS: Record<string, Sector> = {
  ...each(
    'AAPL MSFT NVDA AVGO ORCL CRM ADBE AMD INTC CSCO QCOM IBM TXN NOW AMAT MU PLTR INTU ANET LRCX KLAC ADI SNOW PANW CRWD DELL HPQ',
    'Technology' as const,
  ),
  ...each('AMZN TSLA HD MCD NKE SBUX LOW BKNG CMG TJX F GM ABNB RIVN LULU ROST ORLY', 'Consumer discretionary' as const),
  ...each('GOOGL GOOG META NFLX DIS T VZ TMUS CMCSA CHTR SPOT RDDT', 'Communication' as const),
  ...each('BRK.B BRK.A JPM V MA BAC WFC GS MS AXP C SCHW PYPL BLK COIN HOOD SOFI SPGI CB PGR USB', 'Financials' as const),
  ...each('UNH JNJ LLY PFE MRK ABBV TMO ABT CVS AMGN ISRG GILD BMY DHR MDT CI HUM REGN VRTX', 'Health care' as const),
  ...each('PG KO PEP WMT COST PM MO CL TGT MDLZ KHC KR GIS', 'Consumer staples' as const),
  ...each('XOM CVX COP OXY SLB EOG PSX MPC KMI', 'Energy' as const),
  ...each('BA CAT GE HON UPS RTX LMT DE UNP DAL UBER FDX MMM NOC WM', 'Industrials' as const),
  ...each('NEE DUK SO D AEP EXC SRE', 'Utilities' as const),
  ...each('O AMT PLD SPG EQIX CCI PSA', 'Real estate' as const),
  ...each('LIN NEM FCX DOW SHW APD ECL', 'Materials' as const),
};

/** A single company, not a fund (a fund holds many). */
export function isStock(s: Pick<Security, 'ticker' | 'type'> | undefined, ticker: string): boolean {
  if (FUNDS[ticker]) return false;
  if (STOCKS[ticker]) return true;
  return /stock|depositary|reit/i.test(s?.type ?? '');
}

/** What a holding is: what you set, a popular fund's, or a company's from its listing. */
export function kindOf(ticker: string, s?: Security): AssetKind | undefined {
  if (s?.kind) return s.kind as AssetKind;
  if (FUNDS[ticker]) return FUNDS[ticker];
  const type = s?.type ?? '';
  if (/reit/i.test(type)) return 'realestate';
  if (/depositary/i.test(type)) return 'intl';
  if (STOCKS[ticker] || /stock/i.test(type)) return 'us';
  if (/bond/i.test(type)) return 'bonds';
  return undefined;
}

/** A company's sector: what you set, or a popular one's (funds are diversified, so none). */
export function sectorOf(ticker: string, s?: Security): Sector | undefined {
  return (s?.sector as Sector | undefined) ?? STOCKS[ticker];
}

export interface Slice {
  key: string;
  label: string;
  value: Cents;
  share: number;
}

/** What's held now, by ticker across accounts, and the cash beside it. */
function heldNow(p: Portfolio): { byTicker: Map<string, Cents>; cash: Cents; total: Cents } {
  const byTicker = new Map<string, Cents>();
  let cash = 0;
  for (const hs of p.accounts) {
    cash += cashOn(hs);
    for (const pos of hs.positions) if (pos.value > 0) byTicker.set(pos.ticker, (byTicker.get(pos.ticker) ?? 0) + pos.value);
  }
  const total = cash + [...byTicker.values()].reduce((s, v) => s + v, 0);
  return { byTicker, cash, total };
}

/** By kind, in the usual order; holdings whose kind isn't known are "Not set" (their tickers in `unknown`). */
export function mixByKind(p: Portfolio, securities: Map<string, Security>): { slices: Slice[]; unknown: string[]; total: Cents } {
  const { byTicker, cash, total } = heldNow(p);
  const sums = new Map<string, Cents>([['cash', cash]]);
  const unknown: string[] = [];
  for (const [ticker, value] of byTicker) {
    const kind = kindOf(ticker, securities.get(ticker));
    if (!kind) unknown.push(ticker);
    sums.set(kind ?? 'unset', (sums.get(kind ?? 'unset') ?? 0) + value);
  }
  const slices = [...KINDS.map((k) => ({ key: k.value as string, label: k.label })), { key: 'unset', label: 'Not set' }]
    .map((k) => ({ ...k, value: sums.get(k.key) ?? 0, share: total > 0 ? (sums.get(k.key) ?? 0) / total : 0 }))
    .filter((s) => s.value > 0);
  return { slices, unknown, total };
}

/** Individual companies by sector (funds are left out: they're spread across many). */
export function stocksBySector(p: Portfolio, securities: Map<string, Security>): Slice[] {
  const { byTicker, total } = heldNow(p);
  const sums = new Map<string, Cents>();
  for (const [ticker, value] of byTicker) {
    const s = securities.get(ticker);
    if (!isStock(s, ticker)) continue;
    const sector = sectorOf(ticker, s) ?? 'Not set';
    sums.set(sector, (sums.get(sector) ?? 0) + value);
  }
  return [...sums]
    .map(([key, value]) => ({ key, label: key, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => (a.key === 'Not set' ? 1 : b.key === 'Not set' ? -1 : b.value - a.value));
}

/** One company over this share of everything is a lot riding on it. */
export const ONE_STOCK = 0.2;
/** The three biggest companies over this share. */
export const TOP_THREE = 0.5;
/** One sector's companies over this share. */
export const ONE_SECTOR = 0.4;

export interface Concentration {
  kind: 'stock' | 'top3' | 'sector';
  share: number;
  tickers: string[];
  text: string;
}

const pctText = (x: number) => `${Math.round(x * 100)}%`;

/** Where a lot rides on a few companies (funds don't count: they hold many). */
export function concentration(p: Portfolio, securities: Map<string, Security>): Concentration[] {
  const { byTicker, total } = heldNow(p);
  if (total <= 0) return [];
  const stocks = [...byTicker].filter(([t]) => isStock(securities.get(t), t)).sort((a, b) => b[1] - a[1]);
  const out: Concentration[] = [];
  const [top] = stocks;
  if (top && top[1] / total > ONE_STOCK) {
    out.push({
      kind: 'stock',
      share: top[1] / total,
      tickers: [top[0]],
      text: `${top[0]} is ${pctText(top[1] / total)} of your investments: a bad year for one company would hit hard.`,
    });
  }
  const three = stocks.slice(0, 3);
  const threeShare = three.reduce((s, [, v]) => s + v, 0) / total;
  if (three.length === 3 && threeShare > TOP_THREE) {
    out.push({
      kind: 'top3',
      share: threeShare,
      tickers: three.map(([t]) => t),
      text: `Your 3 biggest companies (${three.map(([t]) => t).join(', ')}) are ${pctText(threeShare)} of your investments.`,
    });
  }
  const sector = stocksBySector(p, securities).find((s) => s.key !== 'Not set' && s.share > ONE_SECTOR);
  if (sector) {
    out.push({
      kind: 'sector',
      share: sector.share,
      tickers: stocks.filter(([t]) => sectorOf(t, securities.get(t)) === sector.key).map(([t]) => t),
      text: `${sector.key} companies are ${pctText(sector.share)} of your investments: one industry’s slump would hit most of it.`,
    });
  }
  return out;
}

/** A mix to aim for: each kind's share (adding up to 1). */
export type TargetMix = Partial<Record<AssetKind, number>>;
export const TARGET_MIX = 'targetMix';

export interface Drift {
  kind: AssetKind;
  label: string;
  share: number;
  target: number;
  value: Cents;
  /** What would put it on target: more (+) or less (−). */
  change: Cents;
}

/** How far each kind is from the mix you aim for (kinds you hold or aim for). */
export function drift(mix: { slices: Slice[]; total: Cents }, target: TargetMix): Drift[] {
  return KINDS.filter((k) => (target[k.value] ?? 0) > 0 || mix.slices.some((s) => s.key === k.value)).map((k) => {
    const value = mix.slices.find((s) => s.key === k.value)?.value ?? 0;
    const goal = target[k.value] ?? 0;
    return { kind: k.value, label: k.label, share: mix.total > 0 ? value / mix.total : 0, target: goal, value, change: Math.round(goal * mix.total) - value };
  });
}

/** Off target by more than this (in points of share) is worth a look. */
export const DRIFT_POINTS = 0.05;
