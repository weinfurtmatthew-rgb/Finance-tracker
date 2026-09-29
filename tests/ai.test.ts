import { describe, expect, it } from 'vitest';
import { answer, parsePeriod, parseQuestion, understand, type AnswerData, type AskContext } from '../src/ai/ask';
import { factSentences, type SummaryFacts } from '../src/ai/summary';
import { explainDescription } from '../src/ai/explain';
import { CATEGORY_SEEDS, matchText, nearestCategory, trainingExamples, VOTE } from '../src/ai/similar';
import { automaticPicks, suggestForUncategorized } from '../src/ai/suggest';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Transaction } from '../src/types';

const today = '2026-09-28';
const ctx: AskContext = { today, categories: DEFAULT_CATEGORIES, merchants: ['Starbucks', "Trader Joe's", 'Netflix', 'Whole Foods', 'Shell Oil'] };
let n = 0;
const tx = (date: string, amount: number, categoryId: string, payee: string): Transaction => ({
  id: `t${n++}`, accountId: 'a', date, amount, description: payee.toUpperCase(), payee, categoryId, notes: '', source: 'csv', createdAt: 0,
});

describe('parsePeriod', () => {
  it.each([
    ['this month', '2026-09-01', '2026-09-28'],
    ['last month', '2026-08-01', '2026-08-31'],
    ['in august', '2026-08-01', '2026-08-31'],
    ['in december', '2025-12-01', '2025-12-31'], // future month means last year
    ['aug 2025', '2025-08-01', '2025-08-31'],
    ['since march', '2026-03-01', '2026-09-28'],
    ['this year', '2026-01-01', '2026-09-28'],
    ['last year', '2025-01-01', '2025-12-31'],
    ['in the last 30 days', '2026-08-30', '2026-09-28'],
    ['last 3 months', '2026-06-01', '2026-08-31'],
    ['yesterday', '2026-09-27', '2026-09-27'],
  ])('%s', (text, from, to) => {
    expect(parsePeriod(text, today)).toMatchObject({ from, to });
  });
  it('"may" only counts as a month when it clearly is one', () => {
    expect(parsePeriod('how much may i spend', today)).toBeNull();
    expect(parsePeriod('in may', today)).toMatchObject({ from: '2026-05-01' });
  });
});

describe('parseQuestion (rules)', () => {
  it.each([
    ['How much did I spend on dining last month?', { intent: 'spending', categoryId: 'dining' }],
    ['how much have i spent eating out this month', { intent: 'spending', categoryId: 'dining' }],
    ['Where did my money go in August?', { intent: 'top_categories' }],
    ['What are my subscriptions?', { intent: 'subscriptions' }],
    ['How many times did I go to Starbucks this year?', { intent: 'count', merchant: 'Starbucks' }],
    ['What was my biggest purchase in August?', { intent: 'largest' }],
    ['Am I over budget?', { intent: 'budget' }],
    ["What's my net worth", { intent: 'net_worth' }],
    ['how much did i make last month', { intent: 'income' }],
    ['groceries in july', { intent: 'spending', categoryId: 'groceries' }],
    ['total at trader joes this year', { intent: 'spending', merchant: "Trader Joe's" }],
    ['how much cash did i drop on food delivery and restaurants in august', { intent: 'spending', categoryId: 'dining' }],
    ['what did i splurge on the most this month', { intent: 'top_categories' }],
    ['how much money came in last month', { intent: 'income' }],
    ['list my streaming services', { intent: 'subscriptions' }],
    ['what is the priciest thing i bought this year', { intent: 'largest' }],
    ['did i blow past my limits', { intent: 'budget' }],
  ])('%s', (q, expected) => {
    expect(parseQuestion(q, ctx)).toMatchObject(expected);
  });
  it('returns null when it does not understand', () => {
    expect(parseQuestion('should i refinance', ctx)).toBeNull();
  });
});

describe('understand (AI fallback with the embedding model)', () => {
  // Fake embeddings: each text maps to the unit vector of the first keyword it contains.
  const KEYS = ['splurge', 'most on', 'streaming', 'subscriptions', 'priciest', 'expensive', 'came in', 'income', 'restaurant', 'dining'];
  const fake = async (texts: string[]) =>
    texts.map((t) => {
      const v = new Array(KEYS.length + 1).fill(0);
      const alias: Record<string, number> = { splurge: 1, streaming: 3, priciest: 5, 'came in': 7, restaurant: 9 };
      const i = KEYS.findIndex((k) => t.includes(k));
      if (i !== -1) v[alias[KEYS[i]] ?? i] = 1; // unrelated text stays a zero vector (similarity 0)
      return v;
    });
  const examples = { ...Object.fromEntries(Object.keys(CATEGORY_SEEDS).map((k) => [k, []])), dining: ['dining'] } as Record<string, string[]>;

  it('rules win when they understand the question', async () => {
    expect(await understand('how much did i spend on gas last month', ctx, fake, examples)).toMatchObject({ intent: 'spending', categoryId: 'gas', source: 'rules' });
  });
  it('falls back to the closest example question', async () => {
    const q = await understand('i wanna know the priciest', ctx, fake, examples);
    expect(q).toMatchObject({ intent: 'largest', source: 'ai' });
  });
  it('loose keyword matches let the AI decide, and fall back to the rule if the AI is unsure', async () => {
    // "blow" is only a weak spending hint; the fake model sees "priciest" and says largest.
    expect(await understand('did i blow it on the priciest stuff', ctx, fake, examples)).toMatchObject({ intent: 'largest', source: 'ai' });
    expect(await understand('did i blow it', ctx, fake, examples)).toMatchObject({ intent: 'spending', source: 'rules' });
  });
  it('returns null when nothing is close enough', async () => {
    expect(await understand('tell me a joke', ctx, fake, examples)).toBeNull();
  });
  it('without AI, only rules are used', async () => {
    expect(await understand('i wanna know the priciest', ctx)).toBeNull();
  });
});

describe('answer (exact numbers)', () => {
  const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
  const txns = [
    tx('2026-08-03', -650, 'dining', 'Starbucks'),
    tx('2026-08-10', -4200, 'dining', 'Chipotle'),
    tx('2026-08-12', -500, 'dining', 'Starbucks'),
    tx('2026-08-15', -12000, 'groceries', 'Whole Foods'),
    tx('2026-08-20', -40000, 'transfer', 'Discover Payment'),
    tx('2026-08-15', 240000, 'income', 'Acme Payroll'),
  ];
  const data: AnswerData = { txns, categories: cats, recurring: [], budgets: [], netWorth: { net: 100000, change: 5000, since: 'Aug 31' } };
  const ask = (q: string) => answer(parseQuestion(q, ctx)!, data);

  it('spending in a category', () => {
    const a = ask('how much did i spend on dining in august');
    expect(a.headline).toBe('You spent $53.50 on Dining in August 2026.');
    expect(a.items?.[0]).toEqual({ label: 'Chipotle', value: 4200 });
    expect(a.filter).toEqual({ categoryId: 'dining', month: '2026-08' });
  });
  it('count at a merchant', () => {
    expect(ask('how many times did i go to starbucks in august').headline).toBe('2 times at Starbucks in August 2026, $11.50 in total.');
  });
  it('top categories ignore transfers', () => {
    const a = ask('where did my money go in august');
    expect(a.headline).toBe('Your biggest category in August 2026 was Groceries: $120.00 of $173.50.');
  });
  it('income', () => {
    expect(ask('how much did i make in august').headline).toBe('You received $2,400.00 in income in August 2026.');
  });
  it('card payments are their own category and not spending', () => {
    const q = parseQuestion('how much did i pay on my credit cards in august', ctx)!;
    expect(q).toMatchObject({ intent: 'spending', categoryId: 'card-payment' });
    const withPayment = { ...data, txns: [...txns, { ...txns[4], id: 'cp', categoryId: 'card-payment' }] };
    expect(answer(q, withPayment).headline).toBe('You spent $400.00 on Credit Card Payment in August 2026.');
    // ...and a general spending question doesn't include it.
    expect(answer(parseQuestion('how much did i spend in august', ctx)!, withPayment).headline).toBe('You spent $173.50 in August 2026.');
  });
});

describe('summary', () => {
  const facts: SummaryFacts = {
    month: '2026-09', label: 'September 2026', current: true, spent: 227100, previous: 250000,
    topCategory: { name: 'Rent & Mortgage', amount: 165000 }, over: ['Dining'], near: [], income: 0, priceIncreases: ['Netflix'], netWorthChange: 272900,
  };
  const sentences = factSentences(facts);
  it('facts are plain sentences', () => {
    expect(sentences[0]).toBe("You've spent $2,271 so far this month, 9% less than at this point last month ($2,500).");
    expect(sentences).toContain('Over budget: Dining.');
  });
});

describe('explain', () => {
  it('decodes common codes', () => {
    const e = explainDescription('TST* BLUE DOOR CAFE 0442 BOSTON MA', -2400);
    expect(e.notes.some((n) => n.startsWith('TST*'))).toBe(true);
    expect(e.notes.some((n) => n.includes('state'))).toBe(true);
    expect(e.suggestedName).toBe('Blue Door Cafe');
    expect(e.categoryId).toBe('dining');
  });
});

describe('similar', () => {
  it('uses your past choices plus category seeds, and votes by similarity', () => {
    const ex = trainingExamples([tx('2026-08-01', -500, 'dining', 'Starbucks'), tx('2026-08-02', -500, 'dining', 'Starbucks'), tx('2026-08-03', -900, 'uncategorized', 'Weird Co')], DEFAULT_CATEGORIES);
    expect(ex.find((e) => e.text === 'starbucks')).toMatchObject({ categoryId: 'dining', weight: 2 });
    expect(ex.some((e) => e.text === 'weird co')).toBe(false);
    // Fake 2-D embeddings: the query points the same way as "starbucks".
    const withVecs = ex.map((e) => ({ ...e, vec: e.text === 'starbucks' ? [1, 0] : [0, 1] }));
    expect(nearestCategory([1, 0], withVecs)).toMatchObject({ categoryId: 'dining', like: 'starbucks' });
    expect(ex.filter((e) => e.seed && e.categoryId === 'dining').length).toBeGreaterThan(3);
  });
});

describe('categorizing with the embedding model', () => {
  // Fake embeddings: bag of words, so texts sharing words are similar (cosine of word counts).
  const bow = async (texts: string[]) => {
    const vocab = new Map<string, number>();
    const words = texts.map((t) => t.split(/\W+/).filter(Boolean));
    words.flat().forEach((w) => vocab.has(w) || vocab.set(w, vocab.size));
    return words.map((ws) => {
      const v = new Array(Math.max(1, vocab.size)).fill(0);
      ws.forEach((w) => v[vocab.get(w)!]++);
      const len = Math.hypot(...v) || 1;
      return v.map((x) => x / len);
    });
  };
  // One shared vocabulary per call, so compare within a single embed call.
  const embedAll = (all: string[]) => {
    let cache: Map<string, number[]> | null = null;
    return async (texts: string[]) => {
      if (!cache) {
        const vecs = await bow(all);
        cache = new Map(all.map((t, i) => [t, vecs[i]]));
      }
      return texts.map((t) => cache!.get(t) ?? new Array(cache!.values().next().value!.length).fill(0));
    };
  };
  const t = (payee: string, amount: number, categoryId: string, categorySource?: Transaction['categorySource'], id = `x${n++}`): Transaction => ({
    id, accountId: 'a', date: '2026-09-01', amount, description: payee.toUpperCase(), payee, categoryId, categorySource, notes: '', source: 'csv', createdAt: 0,
  });
  const texts = (txns: Transaction[]) => [
    ...new Set([...trainingExamples(txns, DEFAULT_CATEGORIES).map((e) => e.text), ...txns.map(matchText)]),
  ];

  it('strips store numbers and symbols before matching', () => {
    expect(matchText({ payee: 'Shell #0042', description: '' })).toBe('shell');
    expect(matchText({ payee: 'SQ *Blue Bottle 3312', description: '' })).toBe('sq blue bottle');
  });

  it('money coming in never gets a spending category, and money going out never becomes income', async () => {
    const history = [t('Blue Cafe', -600, 'dining', 'user'), t('Blue Cafe', -700, 'dining', 'user'), t('Acme Payroll', 250000, 'income', 'user')];
    const deposit = t('Blue Cafe Payroll', 120000, 'uncategorized');
    const purchase = t('Acme Payroll Store', -2000, 'uncategorized');
    const all = [...history, deposit, purchase];
    const groups = await suggestForUncategorized(all, DEFAULT_CATEGORIES, embedAll(texts(all)));
    const pick = (p: string) => groups.find((g) => g.payee === p)?.suggestion?.categoryId;
    expect(pick('Blue Cafe Payroll')).toBe('income');
    expect(pick('Acme Payroll Store')).not.toBe('income');
  });

  it('several agreeing neighbours outvote one odd one', () => {
    const vec = (a: number, b: number) => [a, b, Math.sqrt(Math.max(0, 1 - a * a - b * b))];
    const examples = [
      { text: 'odd', categoryId: 'shopping', weight: 1, vec: vec(0.92, 0) },
      { text: 'a', categoryId: 'dining', weight: 1, vec: vec(0.88, 0.1) },
      { text: 'b', categoryId: 'dining', weight: 1, vec: vec(0.87, 0.12) },
      { text: 'c', categoryId: 'dining', weight: 1, vec: vec(0.86, 0.15) },
    ];
    const s = nearestCategory(vec(1, 0), examples)!;
    expect(s.categoryId).toBe('dining');
    expect(s.share).toBeGreaterThan(0.6);
  });

  it('is only confident when one category clearly wins', () => {
    const tie = nearestCategory([1, 0], [
      { text: 'a', categoryId: 'dining', weight: 1, vec: [0.9, Math.sqrt(1 - 0.81)] },
      { text: 'b', categoryId: 'groceries', weight: 1, vec: [0.9, -Math.sqrt(1 - 0.81)] },
    ])!;
    expect(tie.confident).toBe(false);
    const far = nearestCategory([1, 0], [{ text: 'a', categoryId: 'dining', weight: 1, vec: [VOTE.confidentSimilarity - 0.1, Math.sqrt(1 - (VOTE.confidentSimilarity - 0.1) ** 2)] }])!;
    expect(far.confident).toBe(false);
  });

  it('your own choices teach it; unreviewed AI picks never do', () => {
    const ex = trainingExamples([t('Corner Deli', -900, 'groceries', 'ai'), t('Joes Diner', -900, 'dining', 'user'), t('Mart', -100, 'shopping', 'keyword')], DEFAULT_CATEGORIES);
    expect(ex.some((e) => e.text === 'corner deli')).toBe(false);
    expect(ex.find((e) => e.text === 'joes diner')!.weight).toBeGreaterThan(ex.find((e) => e.text === 'mart')!.weight);
  });

  it('after import, applies confident picks only to guessed categories', async () => {
    const history = [t('Green Leaf Market', -4000, 'groceries', 'user'), t('Green Leaf Market', -3500, 'groceries', 'user'), t('Green Leaf Market', -3000, 'groceries', 'user')];
    const fresh = [
      t('Green Leaf Market', -2500, 'uncategorized', 'default', 'n1'),
      t('Green Leaf Market', -2600, 'other', 'bank', 'n2'),
      t('Green Leaf Market', -2700, 'dining', 'keyword', 'n3'),
      t('Zzyx Qwv', -100, 'uncategorized', 'default', 'n4'),
    ];
    const all = [...history, ...fresh];
    const picks = await automaticPicks(new Set(['n1', 'n2', 'n3', 'n4']), all, DEFAULT_CATEGORIES, embedAll(texts(all)));
    expect(picks.map((p) => p.id).sort()).toEqual(['n1', 'n2']);
    expect(picks.every((p) => p.categoryId === 'groceries')).toBe(true);
  });
});
