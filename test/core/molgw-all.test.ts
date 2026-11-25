// Runs the validator over every input of a MolGW checkout (tests/inputs/*.in), when MOLGW_REPO points at one:
//   MOLGW_REPO=/path/to/molgw npx vitest run test/core/molgw-all.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMolgw } from '../../src/core/molgw/format';
import { parseMolgw } from '../../src/core/molgw/parse';
import { validateMolgw } from '../../src/core/molgw/validate';

const repo = process.env.MOLGW_REPO;
const dir = repo ? join(repo, 'tests', 'inputs') : '';
const inputs = repo && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.in')) : [];

/** The atom count of the xyz file an input names, like the extension reads it. */
function xyzAtoms(text: string, base: string): number | undefined {
  const m = text.match(/xyz_file\s*=\s*['"]([^'"]+)['"]/i);
  if (!m) return undefined;
  const f = join(base, m[1]);
  return existsSync(f) ? Number(readFileSync(f, 'utf8').split('\n')[0]) : undefined;
}

describe.skipIf(!inputs.length)('all inputs of the MolGW testsuite', () => {
  it('raise no errors and no warnings', () => {
    const found: string[] = [];
    for (const f of inputs) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const d of validateMolgw(parseMolgw(text), { xyzAtoms: xyzAtoms(text, dir) })) found.push(`${f}: ${d.severity} ${d.code} ${d.message.slice(0, 200)}`);
    }
    console.log(`${inputs.length} inputs checked`);
    // he_wb97.in really sets mixing_scheme twice (lines 3 and 5): a true duplicate, not a false alarm.
    expect(found.filter((x) => !x.startsWith('he_wb97.in: warning molgw-duplicate'))).toEqual([]);
  });

  it('format idempotently, without changing what MolGW reads', () => {
    for (const f of inputs) {
      const text = readFileSync(join(dir, f), 'utf8');
      const once = formatMolgw(text);
      expect(once, f).toBeDefined();
      expect(formatMolgw(once!), f).toBe(once);
      // The same variables with the same values, and the same atoms.
      const a = parseMolgw(text);
      const b = parseMolgw(once!);
      expect(b.entries.map((e) => [e.key, e.values.map((v) => v.raw)]), f).toEqual(a.entries.map((e) => [e.key, e.values.map((v) => v.raw)]));
      expect(b.atoms.filter((x) => x.fields.length).map((x) => x.fields.map((y) => y.text)), f).toEqual(a.atoms.filter((x) => x.fields.length).map((x) => x.fields.map((y) => y.text)));
    }
  });
});
