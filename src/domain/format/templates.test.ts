import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from './templates';

describe('FORMAT_TEMPLATES', () => {
  it('lässt in jeder Vorlage genau so viele Teams weiterkommen, wie die Endrunden brauchen', () => {
    for (const t of FORMAT_TEMPLATES) {
      const f = t.build();
      const vorrunde = f.stages[0];
      expect(vorrunde?.kind).toBe('groups');
      if (vorrunde?.kind !== 'groups') continue;
      const groupCount = vorrunde.groupCount;
      for (const s of f.stages.slice(1)) {
        const fixed = (s.entry?.places.length ?? 0) * groupCount;
        const best = (s.entry?.best ?? []).reduce((n, b) => n + b.count, 0);
        const needed = s.kind === 'knockout' ? s.size : s.kind === 'placement' ? s.matches.length * 2 : fixed + best;
        expect(fixed + best, `${t.id}/${s.id}`).toBe(needed);
      }
    }
  });

  it('vergibt keinen Endplatz doppelt', () => {
    for (const t of FORMAT_TEMPLATES) {
      const ranges = t.build().stages.flatMap((s) => (s.placeRange ? [s.placeRange] : []));
      const places = ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i));
      expect(new Set(places).size, t.id).toBe(places.length);
    }
  });
});
