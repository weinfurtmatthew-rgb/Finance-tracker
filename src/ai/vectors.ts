import { embed } from './client';

// Embeddings never change for the same text, so keep them for the session.
const cache = new Map<string, ArrayLike<number>>();

export async function vectors(texts: string[]): Promise<ArrayLike<number>[]> {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    const vecs = await embed(missing);
    missing.forEach((t, i) => cache.set(t, vecs[i]));
  }
  return texts.map((t) => cache.get(t)!);
}
