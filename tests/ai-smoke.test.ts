/**
 * Checks the real on-device model (not run by default; CI runs it with AI_SMOKE=1 after
 * scripts/fetch-models.mjs has downloaded them into .models-cache).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { CATEGORY_SEEDS, nearestCategory, trainingExamples } from '../src/ai/similar';
import { understand, type AskContext } from '../src/ai/ask';
import { MODELS } from '../src/ai/models';

const run = process.env.AI_SMOKE === '1';

async function transformers() {
  const t = await import('@huggingface/transformers');
  t.env.allowRemoteModels = false;
  t.env.localModelPath = `${resolve(process.env.MODEL_CACHE ?? '.models-cache')}/`;
  return t;
}

describe.runIf(run)('real on-device models', () => {
  it('embeddings put common merchants in the right category with no training', async () => {
    const { pipeline } = await transformers();
    const embedder = await pipeline('feature-extraction', MODELS.embed.id, { dtype: MODELS.embed.dtype });
    const vec = async (texts: string[]) => {
      const out = await embedder(texts, { pooling: 'mean', normalize: true });
      const d = out.dims[1];
      return texts.map((_, i) => (out.data as Float32Array).slice(i * d, (i + 1) * d));
    };
    const examples = trainingExamples([], DEFAULT_CATEGORIES);
    const exVecs = await vec(examples.map((e) => e.text));
    const indexed = examples.map((e, i) => ({ ...e, vec: exVecs[i] }));
    const groups = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c.group]));
    // [text, expected, money in?]
    const cases: [string, string, boolean?][] = [
      ['shell oil', 'gas'],
      ['whole foods market', 'groceries'],
      ['blue bottle coffee', 'dining'],
      ['delta air lines', 'travel'],
      ['cvs pharmacy', 'health'],
      ['netflix.com', 'subscriptions'],
      ['verizon wireless', 'bills'],
      ['amc theatres', 'entertainment'],
      ['great clips haircut', 'personal'],
      ['geico auto insurance', 'insurance'],
      ['acme corp payroll', 'income', true],
      ['chipotle mexican grill', 'dining'],
      // Direction: the same words must not flip money in/out into the wrong kind of category.
      ['coffee co payroll', 'income', true],
      ['payroll services cafe', 'dining'],
    ];
    const qVecs = await vec(cases.map((c) => c[0]));
    const rows = cases.map((c, i) => {
      const s = nearestCategory(qVecs[i], indexed, { dir: c[2] ? 'in' : 'out', groups });
      return { text: c[0], want: c[1], got: s?.categoryId, sim: s?.similarity.toFixed(2), share: s?.share.toFixed(2), confident: s?.confident };
    });
    console.table(rows);
    expect(rows.filter((r) => r.want === r.got).length).toBeGreaterThanOrEqual(10);
    // Money going out never becomes income, money coming in never becomes spending.
    expect(rows.every((r, i) => (cases[i][2] ? groups.get(r.got!) !== 'expense' : groups.get(r.got!) !== 'income'))).toBe(true);
    // When it's confident, it should be right.
    const confident = rows.filter((r) => r.confident);
    expect(confident.filter((r) => r.want === r.got).length).toBeGreaterThanOrEqual(Math.ceil(confident.length * 0.9));
  }, 300_000);

  it('questions in your own words are understood (rules + embedding model)', async () => {
    const { pipeline } = await transformers();
    const embedder = await pipeline('feature-extraction', MODELS.embed.id, { dtype: MODELS.embed.dtype });
    const embed = async (texts: string[]) => {
      const out = await embedder(texts, { pooling: 'mean', normalize: true });
      const d = out.dims[1];
      return texts.map((_, i) => (out.data as Float32Array).slice(i * d, (i + 1) * d));
    };
    const ctx: AskContext = { today: '2026-09-28', categories: DEFAULT_CATEGORIES, merchants: ['Starbucks', "Trader Joe's", 'Target'] };
    // Phrasings the rules don't cover, so the embedding model has to do the work.
    const cases: [string, string, string?][] = [
      ['what ate up most of my paycheck this month', 'top_categories'],
      ['which shops get the bulk of my cash', 'top_merchants'],
      ['what services do i get billed for every month', 'subscriptions'],
      ['did i blow past my limits', 'budget'],
      ['what did i put the most money into in a single go', 'largest'],
      ['how much does eating at restaurants set me back', 'spending', 'dining'],
      ['how rich am i right now', 'net_worth'],
      ['how much hit my account from work', 'income'],
      ['what is the weather tomorrow', 'none'],
    ];
    const rows = [];
    let ok = 0;
    for (const [q, intent, category] of cases) {
      const parsed = await understand(q, ctx, embed, CATEGORY_SEEDS);
      const got = parsed ? parsed.intent : 'none';
      const good = got === intent && (!category || parsed?.categoryId === category);
      if (good) ok++;
      rows.push({ q, want: `${intent}${category ? `/${category}` : ''}`, got: `${got}${parsed?.categoryId ? `/${parsed.categoryId}` : ''} (${parsed?.source ?? ''})` });
    }
    console.table(rows);
    expect(ok).toBeGreaterThanOrEqual(6);
  }, 300_000);

});
