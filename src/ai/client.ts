/**
 * The app's side of the on-device AI: status, opt-in download, and calls into the worker.
 * Nothing loads until you turn AI on in Settings.
 */
import { useEffect, useState } from 'preact/hooks';
import { getMeta, setMeta } from '../db';
import type { ChatMessage } from './ask';
import type { ModelManifest } from './models';

export type AiPhase = 'checking' | 'unavailable' | 'off' | 'downloading' | 'ready' | 'error';

export interface AiState {
  phase: AiPhase;
  /** Bytes to download for everything (from the site's models/manifest.json). */
  sizeBytes?: number;
  progress?: { loaded: number; total: number };
  embed: boolean;
  llm: boolean;
  llmError?: string;
  error?: string;
}

/** Test hook: a page can provide fake models (used by the automated UI tests). */
interface AiMock {
  embed(texts: string[]): Promise<number[][]>;
  chat(messages: ChatMessage[]): Promise<string>;
}
const mock = () => (globalThis as { __financeAiMock?: AiMock }).__financeAiMock;

let state: AiState = { phase: 'checking', embed: false, llm: false };
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

let started = false;
/** Called once at startup: finds out whether the models are hosted, and reloads them if AI is on. */
export async function initAi() {
  if (started) return;
  started = true;
  if (mock()) return set({ phase: 'ready', embed: true, llm: true, sizeBytes: 0 });
  manifest = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!manifest) return set({ phase: 'unavailable' });
  set({ sizeBytes: manifest.total });
  if (await getMeta<boolean>('aiEnabled')) void load();
  else set({ phase: 'off' });
}

async function load() {
  set({ phase: 'downloading', error: undefined, progress: undefined });
  try {
    await navigator.storage?.persist?.().catch(() => false);
    const r = await call<{ embed: boolean; llm: boolean; llmError?: string }>('load', { llm: true });
    set({ phase: 'ready', embed: r.embed, llm: r.llm, llmError: r.llmError });
  } catch (e) {
    set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

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
  set({ phase: manifest ? 'off' : 'unavailable', embed: false, llm: false, progress: undefined, llmError: undefined });
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

export async function chat(messages: ChatMessage[], maxTokens = 160): Promise<string> {
  const m = mock();
  if (m) return m.chat(messages);
  if (!state.llm) throw new Error('Language model not available');
  return call<string>('chat', { messages, maxTokens });
}
