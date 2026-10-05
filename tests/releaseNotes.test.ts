import { describe, expect, it } from 'vitest';
import { RELEASES, unseenReleases } from '../src/releaseNotes';

describe('release notes', () => {
  it('are newest first, with ids that are never reused', () => {
    const ids = RELEASES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
    for (const r of RELEASES) expect(r.items.length).toBeGreaterThan(0);
  });

  it('shows what you missed since the last one you saw', () => {
    expect(unseenReleases(RELEASES[0].id)).toEqual([]);
    expect(unseenReleases(RELEASES[1].id)).toEqual([RELEASES[0]]);
    expect(unseenReleases(undefined)).toEqual([RELEASES[0]]);
    expect(unseenReleases('something-old')).toEqual([RELEASES[0]]);
  });
});
