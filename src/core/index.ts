export * from './incar/parse';
export * from './incar/edit';
export * from './incar/format';
export * from './incar/values';
export * from './tags/schema';
export * from './tags/definitions';
export * from './tags/known';
export * from './intents/types';
export * from './intents/reader';
export * from './intents/engine';
export * from './intents/sections';
export * from './intents/definitions';
export * from './intents/hubbard';
export * from './poscar/read';
export * from './kpoints/read';
export * from './kpoints/parse';
export * from './kpoints/format';
export * from './validation/rules';

import { setTags } from './incar/edit';
import { formatIncar } from './incar/format';
import { parseIncar } from './incar/parse';
import { INTENTS } from './intents/definitions';
import { intentChanges } from './intents/engine';
import { tagReader } from './intents/reader';

/**
 * A fresh INCAR from a set of intent choices (intent id → choice id): a one-line summary of the
 * choices, then the tags in the sections of the builder, formatted like Format Document does.
 */
export function newIncar(system: string, choices: Record<string, string>): string {
  let text = `SYSTEM = ${system}\n`;
  const chosen: string[] = [];
  for (const kind of INTENTS) {
    const choiceId = choices[kind.id];
    const choice = choiceId ? kind.choices.find((c) => c.id === choiceId) : undefined;
    if (!choice) continue;
    const changes = intentChanges(kind, choiceId, tagReader(parseIncar(text)));
    // Only additions apply to a new file; skip tags an earlier choice already wrote.
    const existing = parseIncar(text).tags;
    const fresh = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== null && !existing.has(k)));
    if (Object.keys(fresh).length === 0) continue;
    chosen.push(choice.label);
    text = setTags(text, fresh);
  }
  const summary = chosen.length ? `# ${chosen.join(' · ')}\n\n` : '';
  return formatIncar(summary + text) ?? summary + text;
}
export * from './poscar/elements';
export * from './poscar/parse';
export * from './poscar/format';
export * from './poscar/hover';
export * from './poscar/geometry';
export * from './potcar/read';
export * from './kpoints/context';
export * from './potcar/check';
export * from './poscar/lint';
export * from './kpoints/generate';
export * from './qe/tags';
export * from './qe/values';
export * from './qe/parse';
export * from './qe/validate';
export * from './qe/hover';
export * from './qe/format';
export * from './qe/upf';
export * from './qe/pseudos';
export * from './qe/structure';
export * from './qe/kpoints';
export * from './qe/convert';
export * from './poscar/masses';
export * from './qe/edit';
export * from './qe/intents';
export * from './qe/reader';
export * from './qe/phRules';
export * from './qe/postRules';
export * from './qe/plot';
export * from './bgw/tags';
export * from './bgw/parse';
export * from './bgw/validate';
export * from './bgw/hover';
export * from './bgw/format';
export * from './bgw/reader';
export * from './bgw/edit';
export * from './bgw/workflow';
export * from './castep/tags';
export * from './castep/parse';
export * from './castep/validate';
export * from './castep/hover';
export * from './castep/format';
// ABINIT
export * from './abinit/tags';
export * from './abinit/values';
export * from './abinit/parse';
export * from './abinit/validate';
export * from './abinit/hover';
export * from './abinit/format';
// MolGW (explicit names: the generic helpers of molgw/tags.ts and molgw/reader.ts stay inside the module)
export { isMolgwInput, startsWithMolgwNamelist, lookupMolgw, molgwKeywords, molgwManualUrl, MOLGW_VERSION, type MolgwKeyword } from './molgw/tags';
export * from './molgw/parse';
export * from './molgw/validate';
export * from './molgw/hover';
export * from './molgw/format';
export * from './structure/view';
export * from './structure/elementData';
