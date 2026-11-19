import { describe, expect, it } from 'vitest';
import { INTENTS, PLAIN_SECTIONS, SECTIONS, SECTION_LABELS, newIncar, plainTags, sectionOf, tagCategory, tagReader, parseIncar } from '../../src/core';
import { CATEGORY_LABELS } from '../../src/core/tags/schema';
import { formatIncar } from '../../src/core/incar/format';

/** Owned by a card of another section: a non-SCF run or an MLFF run is chosen under Calculation, while ICHARG belongs to flow control and the ML_ tags to their own section. */
const CROSS_SECTION = new Set(['ICHARG', 'ML_LMLFF', 'ML_MODE']);

describe('one grouping for the INCAR and the builder', () => {
  it('puts every category in exactly one section', () => {
    for (const category of Object.keys(CATEGORY_LABELS)) expect(SECTIONS.filter((s) => s.categories.includes(category as never))).toHaveLength(1);
    expect(new Set(SECTIONS.map((s) => s.label)).size).toBe(SECTIONS.length);
  });

  it('keeps the tags an intent card owns in the section of that card', () => {
    for (const kind of INTENTS) {
      for (const tag of kind.owns) {
        if (CROSS_SECTION.has(tag)) continue;
        const category = tagCategory(tag);
        expect(category, `${tag} has no category`).toBeDefined();
        expect(SECTION_LABELS[sectionOf(category!)], `${tag} (card ${kind.label})`).toBe(SECTION_LABELS[kind.section]);
      }
    }
  });

  it('shows plain cards only for sections without a preset card', () => {
    expect(PLAIN_SECTIONS).toEqual(['mlff', 'parallel', 'flow']);
    expect(plainTags('mlff', undefined)).toContain('ML_LMLFF');
    for (const id of PLAIN_SECTIONS) expect(INTENTS.some((k) => k.section === id)).toBe(false);
    expect(plainTags('parallel', undefined)).toEqual(['NCORE', 'KPAR']);
    expect(plainTags('flow', undefined)).not.toContain('SYSTEM');
    expect(plainTags('flow', tagReader(parseIncar('EMIN = -10\n')))).toContain('EMIN');
  });

  it('writes a new INCAR with the formatter\'s headers in the builder\'s order', () => {
    const text = newIncar('Si', { calculation: 'relax-ions', functional: 'pbe', spin: 'collinear', smearing: 'gaussian', accuracy: 'production' });
    const headers = [...text.matchAll(/^# (.+)$/gm)].map((m) => m[1]).filter((h) => Object.values(SECTION_LABELS).includes(h as never));
    expect(headers).toEqual(SECTIONS.map((s) => s.label).filter((l) => headers.includes(l)));
    expect(headers.length).toBeGreaterThanOrEqual(4);
    // Already formatted: Format Document changes nothing.
    expect(formatIncar(text)).toBe(text);
  });
});
