/**
 * The app's side of the on-device AI: status, opt-in download, and calls into the worker.
 * Nothing loads until you turn AI on in Settings.
 */
import { useEffect, useState } from 'preact/hooks';
import { deleteMeta, getMeta, setMeta } from '../db';
import { REMOVED_LLM_ID, type ModelManifest } from './models';

export type AiPhase = 'checking' | 'unavailable' | 'off' | 'downloading' | 'ready' | 'error';

export interface AiState {
  phase: AiPhase;
  /** Download size, from the site's models/manifest.json. */
  sizeBytes?: number;
  progress?: { loaded: number; total: number };
  embed: boolean;
  error?: string;
}

/** Test hook: a page can provide a fake model (used by the automated UI tests). */
interface AiMock {
  embed(texts: string[]): Promise<number[][]>;
}
const mock = () => (globalThis as { __financeAiMock?: AiMock }).__financeAiMock;

let state: AiState = { phase: 'checking', embed: false };
const listeners = new Set<() => void>();
function set(patch: Partial<AiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAi(): AiState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

export const aiState = () => state;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let manifest: ModelManifest | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') return set({ progress: { loaded: msg.loaded, total: msg.total } });
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  };
  worker.onerror = (e) => set({ phase: 'error', error: e.message || 'The AI worker crashed (the phone may have run low on memory).' });
  return worker;
}

function call<T>(type: string, payload?: unknown): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
}

/** Phones that had the (now removed) 490 MB language model: delete its files and settings once. */
async function cleanUpRemovedLanguageModel() {
  const had = (await getMeta('aiLlmEnabled')) !== undefined || (await getMeta('aiLlmLoadingSince')) !== undefined;
  if (!had) return;
  for (const name of (await caches?.keys?.()) ?? []) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) if (req.url.includes(REMOVED_LLM_ID)) await cache.delete(req);
  }
  await deleteMeta('aiLlmEnabled');
  await deleteMeta('aiLlmLoadingSince');
}

let started = false;
/** Called once at startup: finds out whether the model is hosted, and reloads it if AI is on. */
export async function initAi() {
  if (started) return;
  started = true;
  if (mock()) return set({ phase: 'ready', embed: true, sizeBytes: 0 });
  await cleanUpRemovedLanguageModel().catch(() => {});
  manifest = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!manifest?.models?.embed) return set({ phase: 'unavailable' });
  set({ sizeBytes: manifest.models.embed.bytes });
  if (await getMeta<boolean>('aiEnabled')) void load();
  else set({ phase: 'off' });
}

async function load() {
  set({ phase: 'downloading', error: undefined, progress: undefined });
  try {
    await navigator.storage?.persist?.().catch(() => false);
    await call('load');
    set({ phase: 'ready', embed: true, progress: undefined });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    set({ phase: 'error', error: `The AI files couldn't be loaded. Check your connection and try again. (${detail.slice(0, 120)})` });
  }
}

/** Turn on the on-device AI. */
export async function enableAi() {
  await setMeta('aiEnabled', true);
  await load();
}

/** Turn AI off and delete the downloaded model files from this phone. */
export async function removeAi() {
  worker?.terminate();
  worker = null;
  pending.clear();
  const names = (await caches?.keys?.()) ?? [];
  await Promise.all(names.filter((n) => /transformers|onnx|ort/i.test(n)).map((n) => caches.delete(n)));
  await setMeta('aiEnabled', false);
  set({ phase: manifest ? 'off' : 'unavailable', embed: false, progress: undefined });
}

export async function embed(texts: string[]): Promise<ArrayLike<number>[]> {
  const m = mock();
  if (m) return m.embed(texts);
  if (!state.embed) throw new Error('AI is off');
  const out: ArrayLike<number>[] = [];
  // Small batches keep memory use modest on the phone.
  for (let i = 0; i < texts.length; i += 32) out.push(...(await call<Float32Array[]>('embed', { texts: texts.slice(i, i + 32) })));
  return out;
}
