import type { Transaction } from '../types';
import { tagKey } from './lines';

/** A transaction matches typed text in its payee, bank description, notes, tags or amount ("12.50"). */
export function matchesQuery(t: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    !!t.tags?.some((x) => tagKey(x).includes(q.replace(/^#/, ''))) ||
    t.payee.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.notes.toLowerCase().includes(q) ||
    (t.amount / 100).toFixed(2).includes(q.replace(/[$,-]/g, ''))
  );
}

const QUESTION_START = /^(how|what|whats|what's|when|where|which|who|why|did|do|does|am|is|are|was|were|can|could|should|will|show|list|compare|tell)\b/;

/** Typed text that reads like a question ("how much…", "am I over budget", "…?") goes to Ask. */
export function looksLikeQuestion(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return false;
  return q.endsWith('?') || (QUESTION_START.test(q) && q.split(/\s+/).length >= 2);
}

/** Recent searches: newest first, no repeats (ignoring case), at most `max`. */
export function addRecent(list: string[], text: string, max = 8): string[] {
  const q = text.trim();
  if (!q) return list;
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max);
}

export interface PlaceMatch {
  key: string;
  name: string;
  count: number;
}

export type TopHit = { kind: 'category'; id: string } | { kind: 'place'; key: string };

/**
 * The one result most likely meant, shown big at the top: a category or store whose name is the text,
 * else one whose name (or a word in it) starts with it. Categories win ties; stores need two visits.
 */
export function topHit(text: string, categories: { id: string; name: string }[], places: PlaceMatch[]): TopHit | null {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return null;
  const starts = (name: string) => name.toLowerCase().split(/[\s&/-]+/).some((w) => w.startsWith(q)) || name.toLowerCase().startsWith(q);
  const cat = categories.find((c) => c.name.toLowerCase() === q);
  if (cat) return { kind: 'category', id: cat.id };
  const place = places.find((p) => p.key === q);
  if (place) return { kind: 'place', key: place.key };
  const catStart = categories.find((c) => starts(c.name));
  if (catStart) return { kind: 'category', id: catStart.id };
  const placeStart = places.find((p) => p.count >= 2 && starts(p.name));
  return placeStart ? { kind: 'place', key: placeStart.key } : null;
}

/**
 * Everything Search looks through, prepared once (lowercased text, store names, amounts) so each
 * keystroke is a quick scan instead of re-reading every transaction.
 */
export interface SearchIndex {
  rows: { t: Transaction; text: string; tags: string[]; amount: string; category: string }[];
  /** Every store, most visited first. */
  places: PlaceMatch[];
}

export function buildSearchIndex(txns: Transaction[], categoryName: (id: string) => string | undefined): SearchIndex {
  const places = new Map<string, PlaceMatch>();
  const rows = txns.map((t) => {
    const key = (t.payee || t.description).trim().toLowerCase();
    if (key) {
      const p = places.get(key);
      if (p) p.count++;
      else places.set(key, { key, name: t.payee || t.description, count: 1 });
    }
    return {
      t,
      // NUL can't be typed, so matches never run across two fields.
      text: `${t.payee}\u0000${t.description}\u0000${t.notes}`.toLowerCase(),
      tags: (t.tags ?? []).map(tagKey),
      amount: (t.amount / 100).toFixed(2),
      category: categoryName(t.categoryId)?.toLowerCase() ?? '',
    };
  });
  return { rows, places: [...places.values()].sort((a, b) => b.count - a.count) };
}

/** The same matches as matchesQuery, plus transactions whose category name contains the text ("coffee" finds Starbucks). */
export function searchTransactions(index: SearchIndex, query: string): Transaction[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.rows.map((r) => r.t);
  const tagQ = q.replace(/^#/, '');
  const amountQ = q.replace(/[$,-]/g, '');
  return index.rows
    .filter((r) => r.tags.some((x) => x.includes(tagQ)) || r.text.includes(q) || r.amount.includes(amountQ) || r.category.includes(q))
    .map((r) => r.t);
}

/** Stores whose name contains the text, most visited first. */
export function searchPlaces(index: SearchIndex, query: string, limit = 5): PlaceMatch[] {
  const q = query.trim().toLowerCase();
  const out: PlaceMatch[] = [];
  for (const p of index.places) {
    if (p.key.includes(q)) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
