/// <reference lib="webworker" />
/**
 * Runs the on-device embedding model off the main thread. Everything is loaded from this site's
 * /models/ and /ort/ folders; remote model downloads are disabled.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { MODELS } from './models';

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
// A site path, not a full URL: Transformers.js only looks for optional files (like the tokenizer)
// in "local" paths, and treats full http(s) URLs as remote, which are disabled here.
env.localModelPath = `${import.meta.env.BASE_URL}models/`;
env.useBrowserCache = true;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded.asyncify.wasm` };
wasm.numThreads = 1; // threads need cross-origin isolation, which GitHub Pages can't enable

let embedder: FeatureExtractionPipeline | null = null;

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

async function loadEmbed() {
  if (embedder) return;
  const p = (await pipeline('feature-extraction', MODELS.embed.id, { dtype: MODELS.embed.dtype, device: 'wasm', progress_callback: onProgress })) as FeatureExtractionPipeline;
  if (!p.tokenizer) throw new Error('The embedding model loaded without its tokenizer.');
  embedder = p;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: string; payload?: any }>) => {
  const { id, type, payload } = e.data;
  try {
    let result: unknown;
    if (type === 'load') result = await loadEmbed();
    else if (type === 'embed') {
      if (!embedder) throw new Error('Embedding model not loaded');
      const out = await embedder(payload.texts, { pooling: 'mean', normalize: true });
      const dims = out.dims[1];
      const data = out.data as Float32Array;
      result = payload.texts.map((_: string, i: number) => data.slice(i * dims, (i + 1) * dims));
    } else throw new Error(`Unknown request: ${type}`);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
