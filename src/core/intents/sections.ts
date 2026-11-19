// The builder's Setup column follows the sections of the INCAR (see SECTIONS in tags/schema.ts):
// one heading per section, in the formatter's order, with the cards of that section under it.
// Sections that no intent card covers get a plain card with the tags people actually set there.

import type { TagReader } from './reader';
import { TAG_DEFS } from '../tags/definitions';
import { SECTIONS, sectionOf, type SectionId } from '../tags/schema';
import { INTENTS } from './definitions';

/** DFT+U has its own card (a table per species), not a list of tags. */
const OWN_CARD: SectionId[] = ['ldau'];

/** Sections shown as a plain card of tag fields: no intent card, no special card, and curated tags to show. */
export const PLAIN_SECTIONS: SectionId[] = SECTIONS.map((s) => s.id).filter((id) => !INTENTS.some((k) => k.section === id) && !OWN_CARD.includes(id) && plainTags(id, undefined).length > 0);

/**
 * The tags a plain section card shows: the curated ones that are not marked advanced, plus any
 * of the section that are set. A tag a preset also writes (ICHARG, ML_MODE) is shown here too. SYSTEM
 * is the title of the builder, not a field.
 */
export function plainTags(section: SectionId, r: TagReader | undefined): string[] {
  return TAG_DEFS.filter((d) => sectionOf(d.category) === section && d.name !== 'SYSTEM' && (!d.advanced || r?.has(d.name))).map((d) => d.name);
}
