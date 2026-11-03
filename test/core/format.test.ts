import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_OPTIONS, formatIncar } from '../../src/core/incar/format';
import { parseIncar } from '../../src/core/incar/parse';
import { CATEGORY_LABELS } from '../../src/core/tags/schema';

const HEADERS = new Set([...Object.values(CATEGORY_LABELS), 'Other tags'].map((l) => `# ${l}`));
const fixtures = join(__dirname, '..', 'fixtures');
const incars = readdirSync(fixtures).filter((f) => f.startsWith('INCAR')).map((f) => readFileSync(join(fixtures, f), 'utf8'));

const TRICKY = [
  'ncore = 4\nencut = 520 ! cut\nKERNEL_TRUNCATION {\n  LTRUNCATE = T\n}  # trunc\nismear = 0 ; sigma = 0.05 ! smearing\nMAGMOM = 1 1 \\\n  -1 -1\n',
  '# preamble\n\n# about ENCUT\nENCUT = 400\nSYSTEM = "quoted ; # value"\n# footer\n',
  'ENCUT = 400\r\nISMEAR = 0 ! gauss\r\n',
  'ENCUT =\nLSOL = .TRUE.\nNEW_FLAG = 1\n',
];

/** Statements (key, value) and comment texts, order-independent. */
function content(text: string) {
  const doc = parseIncar(text);
  return {
    entries: doc.entries.map((e) => `${e.key}=${e.value}`).sort(),
    comments: doc.comments.map((c) => text.slice(c.start, c.end)).sort(),
  };
}

describe('formatIncar', () => {
  it('never loses or changes a statement or a comment', () => {
    for (const text of [...incars, ...TRICKY]) {
      const out = formatIncar(text, { ...DEFAULT_FORMAT_OPTIONS, logicals: 'keep' })!;
      const before = content(text);
      const after = content(out);
      expect(after.entries).toEqual(before.entries);
      // Only the category headers it writes itself are added.
      expect(after.comments.filter((c) => !HEADERS.has(c) || before.comments.includes(c))).toEqual(before.comments);
      expect(parseIncar(out).issues).toEqual([]);
    }
  });

  it('is idempotent', () => {
    for (const text of [...incars, ...TRICKY]) {
      const once = formatIncar(text)!;
      expect(formatIncar(once)).toBe(once);
    }
  });

  it('groups, upper-cases, splits statements and aligns', () => {
    expect(formatIncar('sigma = 0.05 ! width\nismear = 0 ! gauss\nencut = 520 ; NCORE = 4\nEDIFF = 1E-6\nsystem = Si bulk\n')).toBe(
      [
        'SYSTEM = Si bulk',
        '',
        '# Electronic structure',
        'ENCUT = 520',
        'EDIFF = 1E-6',
        '',
        '# Occupations & smearing',
        'ISMEAR = 0     ! gauss',
        'SIGMA  = 0.05  ! width',
        '',
        '# Parallelization',
        'NCORE = 4',
        '',
      ].join('\n'),
    );
  });

  it('reuses hand-written section headings and keeps other comments with their tag', () => {
    const out = formatIncar('# DFT+U (Dudarev)\nLDAU = .TRUE.\n# U on Fe d\nLDAUU = 3.8 0\n')!;
    expect(out).toBe('# DFT+U (Dudarev)\nLDAU  = .TRUE.\n# U on Fe d\nLDAUU = 3.8 0\n');
  });

  it('sorts commented-out tags with their category and keeps closing comments with their paragraph', () => {
    // From testing 0.4.0: "# ML_MB" was moved to the paragraph below it.
    const text = '# MLFF Settings\nML_MODE      = run\nML_LMLFF     = .TRUE.\n# ML_MB      = 2000\n\n# Write/Start\nNWRITE       = 0\nISTART       = 0\n';
    const out = formatIncar(text)!;
    const mlff = out.slice(out.indexOf('# MLFF Settings')).split('\n\n')[0];
    expect(mlff).toBe('# MLFF Settings\nML_LMLFF = .TRUE.\nML_MODE  = run\n# ML_MB      = 2000');
    expect(formatIncar('ENCUT = 400\n! check this later\n\nNSW = 0\n')).toContain('ENCUT = 400\n! check this later\n');
  });

  it('keeps comments at the top and bottom of the file there', () => {
    const out = formatIncar('# my run\n\nENCUT = 400\n\n# end notes\n')!;
    expect(out).toBe('# my run\n\n# Electronic structure\nENCUT = 400\n\n# end notes\n');
  });

  it('keeps Windows line endings', () => {
    expect(formatIncar('encut = 400\r\n')).toBe('# Electronic structure\r\nENCUT = 400\r\n');
  });

  it('sorts tags without a curated definition by their wiki category', () => {
    // From testing 0.4.0: ML_OUTPUT_MODE belongs with the MLFF tags, not under "Other tags".
    const out = formatIncar('ML_OUTPUT_MODE = 0\nML_LMLFF = .TRUE.\nNEW_FLAG = 1\nKERNEL_TRUNCATION {\n  LTRUNCATE = T\n}\n')!;
    expect(out).toContain('# Machine-learned force fields\nML_LMLFF       = .TRUE.\nML_OUTPUT_MODE = 0\n');
    expect(out).toContain('# Other tags\nNEW_FLAG = 1\n');
    expect(out).not.toMatch(/# Other tags[\s\S]*KERNEL_TRUNCATION/);
  });

  it('can keep the file order and skip headers', () => {
    const options = { ...DEFAULT_FORMAT_OPTIONS, groupByCategory: false };
    expect(formatIncar('nsw = 10\nencut = 400\n', options)).toBe('NSW   = 10\nENCUT = 400\n');
    expect(formatIncar('encut = 400\n', { ...DEFAULT_FORMAT_OPTIONS, categoryHeaders: false })).toBe('ENCUT = 400\n');
  });

  it('spells logical values one way, including inside blocks', () => {
    // Requested while testing 0.5.0.
    const text = 'LWAVE = F\nLCHARG = .true.\nLASPH = True\nLREAL = .FALSE.\nSYSTEM = T\nKERNEL_TRUNCATION {\n  LTRUNCATE = .T.\n}\n';
    const dotted = formatIncar(text)!;
    expect(dotted).toMatch(/LWAVE\s+= \.FALSE\./);
    expect(dotted).toMatch(/LCHARG\s+= \.TRUE\./);
    expect(dotted).toMatch(/LASPH\s+= \.TRUE\./);
    expect(dotted).toContain('LTRUNCATE = .TRUE.');
    expect(dotted).toContain('SYSTEM = T'); // a string tag, not a logical
    const short = formatIncar(text, { ...DEFAULT_FORMAT_OPTIONS, logicals: 'T' })!;
    expect(short).toMatch(/LWAVE\s+= F\n/);
    expect(short).toMatch(/LREAL\s+= \.FALSE\./); // LREAL also takes Auto/On: left as written
    expect(short).toContain('LTRUNCATE = T');
    expect(formatIncar(text, { ...DEFAULT_FORMAT_OPTIONS, logicals: 'keep' })).toContain('LASPH = True');
  });

  it('refuses to format text it cannot place', () => {
    expect(formatIncar('ENCUT 400\nNSW = 1\n')).toBeUndefined();
    expect(formatIncar('PLUGINS {\nSTRUCTURE = T\n')).toBeUndefined();
  });
});
