/// <reference lib="webworker" />
/**
 * Runs the on-device models off the main thread. Everything is loaded from this site's /models/ and
 * /ort/ folders; remote model downloads are disabled.
 */
import { env, pipeline, type FeatureExtractionPipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { MODELS } from './models';

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${base}models/`;
env.useBrowserCache = true;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded.asyncify.wasm` };
wasm.numThreads = 1; // threads need cross-origin isolation, which GitHub Pages can't enable

let embedder: FeatureExtractionPipeline | null = null;
let generator: TextGenerationPipeline | null = null;

const files = new Map<string, { loaded: number; total: number }>();
function onProgress(p: { status: string; file?: string; name?: string; loaded?: number; total?: number }) {
  if (p.status !== 'progress' && p.status !== 'done') return;
  const key = `${p.name}/${p.file}`;
  const prev = files.get(key) ?? { loaded: 0, total: 0 };
  files.set(key, { loaded: p.status === 'done' ? prev.total || prev.loaded : (p.loaded ?? 0), total: p.total ?? prev.total });
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  self.postMessage({ type: 'progress', loaded, total });
}

async function load(wantLlm: boolean) {
  embedder ??= (await pipeline('feature-extraction', MODELS.embed.id, { dtype: MODELS.embed.dtype, device: 'wasm', progress_callback: onProgress })) as FeatureExtractionPipeline;
  let llmError: string | undefined;
  if (wantLlm && !generator) {
    const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu || !(await gpu.requestAdapter().catch(() => null))) llmError = 'WebGPU is not available in this browser.';
    else {
      try {
        generator = (await pipeline('text-generation', MODELS.llm.id, { dtype: MODELS.llm.dtype, device: 'webgpu', progress_callback: onProgress })) as TextGenerationPipeline;
      } catch (e) {
        llmError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return { embed: !!embedder, llm: !!generator, llmError };
}

self.onmessage = async (e: MessageEvent<{ id: number; type: string; payload?: any }>) => {
  const { id, type, payload } = e.data;
  try {
    let result: unknown;
    if (type === 'load') result = await load(payload.llm);
    else if (type === 'embed') {
      if (!embedder) throw new Error('Embedding model not loaded');
      const out = await embedder(payload.texts, { pooling: 'mean', normalize: true });
      const dims = out.dims[1];
      const data = out.data as Float32Array;
      result = payload.texts.map((_: string, i: number) => data.slice(i * dims, (i + 1) * dims));
    } else if (type === 'chat') {
      if (!generator) throw new Error('Language model not loaded');
      const out = (await generator(payload.messages, { max_new_tokens: payload.maxTokens ?? 160, do_sample: false })) as Array<{ generated_text: Array<{ content: string }> }>;
      result = out[0].generated_text.at(-1)?.content ?? '';
    } else throw new Error(`Unknown request: ${type}`);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
