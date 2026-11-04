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
export * from './intents/definitions';
export * from './intents/hubbard';
export * from './poscar/read';
export * from './kpoints/read';
export * from './kpoints/parse';
export * from './kpoints/format';
export * from './validation/rules';

import { setTags } from './incar/edit';
import { parseIncar } from './incar/parse';
import { INTENTS } from './intents/definitions';
import { intentChanges } from './intents/engine';
import { tagReader } from './intents/reader';

/** A fresh INCAR from a set of intent choices (intent id → choice id), grouped with comment headers. */
export function newIncar(system: string, choices: Record<string, string>): string {
  let text = `SYSTEM = ${system}\n`;
  for (const kind of INTENTS) {
    const choiceId = choices[kind.id];
    if (!choiceId) continue;
    const choice = kind.choices.find((c) => c.id === choiceId);
    if (!choice) continue;
    const changes = intentChanges(kind, choiceId, tagReader(parseIncar(text)));
    // Only additions apply to a new file; skip tags an earlier section already wrote.
    const existing = parseIncar(text).tags;
    const fresh = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== null && !existing.has(k)));
    if (Object.keys(fresh).length === 0) continue;
    text += `\n# ${kind.label}: ${choice.label}\n`;
    text = setTags(text, fresh);
  }
  return text;
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
