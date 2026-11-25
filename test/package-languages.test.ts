import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('language ids', () => {
  it('registers only languages the package contributes, and gives every contributed language a grammar and a config', () => {
    const pkg = JSON.parse(read('package.json'));
    const contributed = new Set<string>(pkg.contributes.languages.map((l: { id: string }) => l.id));
    const used = new Set<string>();
    for (const file of ['src/extension/inputLanguages.ts', 'src/extension/castepLanguages.ts']) {
      const text = read(file);
      for (const m of text.matchAll(/^\s+id: '([a-z][a-z0-9-]*)',$/gm)) used.add(m[1]);
      for (const m of text.matchAll(/setTextDocumentLanguage\(\s*\w+,\s*'([^']+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const id of used) expect(contributed, `language "${id}" is not in contributes.languages`).toContain(id);
    // Language ids are lower case: VS Code compares them exactly.
    for (const id of contributed) expect(id).toBe(id.toLowerCase());
    const grammars = new Set<string>(pkg.contributes.grammars.map((g: { language: string }) => g.language));
    for (const id of grammars) expect(contributed, `grammar for unknown language "${id}"`).toContain(id);
  });
});
