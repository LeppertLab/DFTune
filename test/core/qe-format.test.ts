import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatQe } from '../../src/core/qe/format';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf } from '../../src/core/qe/tags';

const dir = join(__dirname, '..', 'fixtures', 'qe');
const fixtures = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

const TRICKY = [
  // everything on few lines, comments in odd places, array continued over lines, &END
  "&control calculation='scf', prefix = 'x' ! run\n  ! standalone\n  outdir='./o'\n&end\n&system ibrav=1,\n celldm(1)=5.0, nat=1,ntyp=1, ecutwfc=20 ! cutoff\n/ ! close\n&electrons\n/\nATOMIC_SPECIES\n X 1.0 x.UPF ! species\nATOMIC_POSITIONS (bohr)\n ! about the atom\n X 0 0 0 0 0 0\nK_POINTS gamma\n",
  // logicals, repeated values, quoted string with special characters, unknown variable name
  "&CONTROL\n tprnfor = T, tstress=.TRUE.\n title = 'a ! b / c'\n MyOwnVariable = 1\n/\n&SYSTEM\n starting_magnetization(1)=0.5, starting_magnetization( 2 ) = -0.5\n/\n",
  // blank lines between groups, CRLF
  "&CONTROL\r\n calculation = 'scf'\r\n\r\n prefix = 'a'\r\n/\r\nK_POINTS {gamma}\r\n",
  // band path with labels, occupations, comments in cards
  "&CONTROL\n/\nK_POINTS tpiba_b\n# path\n3\n gG 10\n 0.5 0.5 0 5 ! X\n  L 1\nOCCUPATIONS\n 2.0 2.0 1.0\n 1.0 0.0 0.0\n",
];

/** Words (variable names lower-cased, case-insensitive logicals ignored) and comments, in order. */
function content(text: string) {
  // Spaces inside an index list are removed: celldm( 1 ) → celldm(1).
  const words = text.replace(/\r/g, '').replace(/\(\s*([^)]*?)\s*\)/g, '($1)').split(/[\s,=]+/).filter(Boolean).map((w) => w.toLowerCase());
  const comments = [...text.matchAll(/[!#].*$/gm)].map((m) => m[0].trim());
  // &END and / both close a namelist; braces around card options are optional.
  return { words: words.filter((w) => !/^\.?(true|false|t|f)\.?$/.test(w) && !/^[{}()]$/.test(w) && w !== '&end' && w !== '/').map((w) => w.replace(/[{}()]/g, '')).sort(), comments: comments.sort() };
}

describe('formatQe', () => {
  it('lines up namelists and cards', () => {
    expect(formatQe("&control\n calculation='scf', prefix='si' ! run\n pseudo_dir = './p'\n/\nATOMIC_SPECIES\nSi 28.086 Si.UPF\nGe 72.6 Ge.pbe.UPF\nATOMIC_POSITIONS (alat)\nSi 0 0 0\nGe 0.25 0.25 -0.25\nK_POINTS automatic\n4 4 4 1 1 1\n")).toBe(
      [
        '&CONTROL',
        "  calculation = 'scf'",
        "  prefix      = 'si'  ! run",
        "  pseudo_dir  = './p'",
        '/',
        'ATOMIC_SPECIES',
        '  Si  28.086  Si.UPF',
        '  Ge  72.6    Ge.pbe.UPF',
        'ATOMIC_POSITIONS {alat}',
        '  Si  0     0      0',
        '  Ge  0.25  0.25  -0.25',
        'K_POINTS {automatic}',
        '  4 4 4 1 1 1',
        '',
      ].join('\n'),
    );
  });

  it('uses the documented spelling of variables and logicals, and keeps unknown names', () => {
    const out = formatQe(TRICKY[1])!;
    expect(out).toContain('tprnfor       = .true.');
    expect(out).toContain('tstress       = .true.');
    expect(out).toContain('MyOwnVariable = 1');
    expect(out).toContain("title         = 'a ! b / c'");
    expect(out).toContain('starting_magnetization(2) = -0.5');
  });

  it('keeps comments and blank lines, and puts one variable on each line', () => {
    const out = formatQe(TRICKY[0])!;
    expect(out.split('\n').slice(0, 8)).toEqual(['&CONTROL', "  calculation = 'scf'", "  prefix      = 'x'  ! run", '  ! standalone', "  outdir      = './o'", '/', '&SYSTEM', '  ibrav     = 1']);
    expect(out).toContain('/  ! close');
    expect(formatQe(TRICKY[2])).toBe("&CONTROL\r\n  calculation = 'scf'\r\n\r\n  prefix      = 'a'\r\n/\r\nK_POINTS {gamma}\r\n");
  });

  it('formats band paths and generic cards', () => {
    const out = formatQe(TRICKY[3])!;
    expect(out).toContain('K_POINTS {tpiba_b}\n  # path\n  3\n  gG  10\n');
    expect(out).toContain('  0.5  0.5  0  5  ! X');
    expect(out).toContain('OCCUPATIONS\n  2.0 2.0 1.0\n  1.0 0.0 0.0\n');
  });

  it('never loses a word or a comment, and is idempotent', () => {
    for (const [name, text] of [...fixtures, ...TRICKY.map((t, i) => [`tricky ${i}`, t] as const)]) {
      const once = formatQe(text)!;
      expect(once, name).toBeDefined();
      expect(content(once), name).toEqual(content(text));
      expect(formatQe(once), name).toBe(once);
      expect(parseQe(once, { cards: cardsOf('pw') }).issues, name).toEqual([]);
    }
  });

  it('refuses files with syntax errors and unknown programs', () => {
    expect(formatQe('&CONTROL\n calculation = "scf\n/\n')).toBeUndefined();
    expect(formatQe('&CONTROL\n prefix = "x"\n&SYSTEM\n/\n')).toBeUndefined();
    expect(formatQe('nothing to see\n')).toBeUndefined();
  });

  it('formats the other programs the same way', () => {
    expect(formatQe("&inputph\n prefix='si', ldisp=.true.,nq1=4,nq2=4 nq3=4\n/\n")).toBe("&INPUTPH\n  prefix = 'si'\n  ldisp  = .true.\n  nq1    = 4\n  nq2    = 4\n  nq3    = 4\n/\n");
  });
});
