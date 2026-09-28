/**
 * Checks the real on-device models (not run by default; CI runs it with AI_SMOKE=1 after
 * scripts/fetch-models.mjs has downloaded them into .models-cache).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { nearestCategory, trainingExamples } from '../src/ai/similar';
import { llmMessages, parseLlmOutput, type AskContext } from '../src/ai/ask';
import { explainMessages, parseExplain } from '../src/ai/explain';
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
    const cases: [string, string][] = [
      ['shell oil 57444', 'gas'],
      ['whole foods market', 'groceries'],
      ['blue bottle coffee', 'dining'],
      ['delta air lines', 'travel'],
      ['cvs pharmacy', 'health'],
      ['netflix.com', 'subscriptions'],
      ['verizon wireless', 'bills'],
      ['amc theatres', 'entertainment'],
      ['great clips haircut', 'personal'],
      ['geico auto insurance', 'insurance'],
      ['acme corp payroll', 'income'],
      ['chipotle mexican grill', 'dining'],
    ];
    const qVecs = await vec(cases.map((c) => c[0]));
    const got = cases.map((c, i) => [c[0], c[1], nearestCategory(qVecs[i], indexed)?.categoryId]);
    console.table(got);
    expect(got.filter(([, want, have]) => want === have).length).toBeGreaterThanOrEqual(8);
  }, 300_000);

  it('language model turns questions into lookups', async () => {
    const { pipeline } = await transformers();
    let generator;
    try {
      generator = await pipeline('text-generation', MODELS.llm.id, { dtype: MODELS.llm.dtype });
    } catch (e) {
      // q4f16 is built for WebGPU; some CPU builds of ONNX Runtime can't run it. Report, don't fail.
      console.warn(`Language model could not run on this CPU runner: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const ctx: AskContext = { today: '2026-09-28', categories: DEFAULT_CATEGORIES, merchants: ['Starbucks', "Trader Joe's", 'Target'] };
    const cases: [string, string, string?][] = [
      ['how much cash did i drop on food delivery and restaurants in august', 'spending', 'dining'],
      ['what did i splurge on the most this month', 'top_categories'],
      ['total spent at target since june', 'spending'],
      ['how much money came in last month', 'income'],
      ['list my streaming services', 'subscriptions'],
      ['what is the priciest thing i bought this year', 'largest'],
    ];
    const rows = [];
    let ok = 0;
    for (const [q, intent, category] of cases) {
      const out = (await generator(llmMessages(q, ctx), { max_new_tokens: 100, do_sample: false })) as Array<{ generated_text: Array<{ content: string }> }>;
      const text = out[0].generated_text.at(-1)?.content ?? '';
      const parsed = parseLlmOutput(text, ctx);
      const good = parsed?.intent === intent && (!category || parsed.categoryId === category);
      if (good) ok++;
      rows.push({ q, want: `${intent}${category ? `/${category}` : ''}`, got: parsed ? `${parsed.intent}/${parsed.categoryId ?? ''}` : text.slice(0, 60) });
    }
    console.table(rows);
    const ex = (await generator(explainMessages('TST* BLUE DOOR CAFE 0442 BOSTON MA'), { max_new_tokens: 40, do_sample: false })) as Array<{ generated_text: Array<{ content: string }> }>;
    console.log('explain:', parseExplain(ex[0].generated_text.at(-1)?.content ?? ''));
    expect(ok).toBeGreaterThanOrEqual(4);
  }, 900_000);
});
