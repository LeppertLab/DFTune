// Checks on an ABINIT main input. Errors are kept for what ABINIT itself rejects; every rule names the place
// it comes from: the parser (`src/42_parser/m_parser.F90`: instrng, intagm, inarray, chkvars_in_string), the
// readers (`src/57_iovars/m_invars1.F90`, `m_invars2.F90`, `m_ingeo.F90`, `m_inkpts.F90`), the consistency checks
// (`src/57_iovars/m_chkinp.F90`) or the variable documentation (https://docs.abinit.org/variables/).
// What the documentation only advises is a warning.

import type { Span } from '../incar/parse';
import type { Diagnostic, Fix } from '../validation/rules';
import { editDistance } from '../validation/rules';
import type { AbinitDoc, AbinitEntry } from './parse';
import { abinitVariableNames, ABINIT_QUOTED_STRINGS, ABINIT_UNIT_WORDS } from './tags';
import { readAbinitValue } from './values';

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => void;

/** The nearest variable name (or unit, after values) by edit distance, for did-you-mean. */
export function closestAbinitName(name: string, units = false): string | undefined {
  const lower = name.toLowerCase();
  const names = units ? [...abinitVariableNames(), ...Object.keys(ABINIT_UNIT_WORDS)] : abinitVariableNames();
  let best: string | undefined;
  let bestDist = lower.length > 6 ? 2 : 1;
  for (const n of names) {
    if (Math.abs(n.length - lower.length) > bestDist) continue;
    const d = editDistance(lower, n);
    if (d > 0 && (best ? d < bestDist : d <= bestDist)) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

/** Dimensions of the arrays whose length ABINIT checks, as the documentation gives them (typat: natrd, see m_ingeo.F90). */
const COUNTED: Record<string, string[]> = {
  acell: ['3'],
  rprim: ['3', '3'],
  scalecart: ['3'],
  ngkpt: ['3'],
  kptrlatt: ['3', '3'],
  shiftk: ['3', 'nshiftk'],
  ngfft: ['3'],
  amu: ['ntypat'],
  spinat: ['3', 'natrd'],
  typat: ['natrd'],
  znucl: ['npsp'],
  xred: ['3', 'natrd'],
  xcart: ['3', 'natrd'],
  jdtset: ['ndtset'],
  kpt: ['3', 'nkpt'],
  udtset: ['2'],
};

/** Inputs that make natom/typat/xred come from somewhere else than their variables. */
const GEOMETRY_ELSEWHERE = ['structure', 'xyzfile', 'supercell_latt', 'nobj', 'vacnum', 'natrd'];

/** Read by m_inkpts.F90 only for kptopt 1 to 4. */
const KPT_GATED = ['ngkpt', 'kptrlatt', 'shiftk', 'nshiftk'];

const TOL_SCF = ['toldfe', 'toldff', 'tolrff', 'toldmag', 'tolvrs'];

// m_chkinp.F90 (chkint_eq on ionmov)
const IONMOV_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26, 28];
// m_chkinp.F90: when optcell/=0, ionmov must be one of these
const IONMOV_CELL = [2, 3, 13, 15, 16, 22, 25, 28];

type Pick = AbinitEntry | 'series' | undefined;

export function validateAbinit(doc: AbinitDoc): Diagnostic[] {
  const out: Diagnostic[] = [...doc.issues];
  const reported = new Set<string>();
  const report: Report = (severity, code, message, span, fix) => {
    // One report per place and kind of problem: the same entry is met again for every dataset it applies to.
    const key = `${code}@${span.start}:${span.end}|${message.replace(/\(dataset \d+\)|\d+/g, '#')}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({ severity, code, message, span, ...(fix && { fix }) });
  };
  const start: Span = { start: 0, end: 0 };

  // ---- names (chkvars_in_string: "This name is not one of the registered input variable names")
  const byBase = new Map<string, AbinitEntry[]>();
  for (const [i, e] of doc.entries.entries()) {
    if (!e.variable) {
      const close = closestAbinitName(e.base, !!doc.entries[i - 1]?.args.length);
      const fixSpan = { start: e.keySpan.start, end: e.keySpan.start + e.base.length };
      report('error', 'abinit-unknown-variable', `${e.base} is not a registered ABINIT input variable: ABINIT stops on it (https://docs.abinit.org/variables/)${close ? `. Did you mean ${close}?` : '.'}`, e.keySpan, close ? { title: `Change to ${close}`, edit: { ...fixSpan, text: close } } : undefined);
      continue;
    }
    const k = e.variable.name;
    byBase.set(k, [...(byBase.get(k) ?? []), e]);
  }
  const plainOf = (name: string) => byBase.get(name)?.find((e) => e.kind.kind === 'plain');

  // ---- datasets (parsefile, instrng, m_invars1.F90)
  const ndEntry = plainOf('ndtset');
  const intOfEntry = (e: AbinitEntry | undefined): number | undefined => {
    const t = e?.args[0];
    if (!t) return undefined;
    const r = readAbinitValue(t.text, 'int');
    return r.error || r.value === undefined || !Number.isFinite(r.count) ? undefined : r.value;
  };
  const ndtset = intOfEntry(ndEntry) ?? 0;
  if (ndEntry && (ndtset < 0 || ndtset > 9999)) report('error', 'abinit-ndtset', `ndtset must be between 0 and 9999 (parsefile: "Input ndtset must be non-negative and < 10000"), found ${ndtset}.`, ndEntry.args[0]);

  const jd = plainOf('jdtset');
  const ud = plainOf('udtset');
  let datasets: number[] = ndtset > 0 ? Array.from({ length: Math.min(ndtset, 9999) }, (_, i) => i + 1) : [0];
  if (jd && ud) report('error', 'abinit-udtset', 'jdtset and udtset cannot both be defined (m_invars1.F90: "jdtset and udtset cannot be defined both in the input file").', ud.keySpan);
  if (ndtset > 0 && jd && !ud) {
    const vals = valuesOf(jd, 'int');
    if (vals.length >= ndtset) {
      datasets = vals.slice(0, ndtset);
      for (const [i, v] of datasets.entries()) {
        if (v < 1 || v > 9999) report('error', 'abinit-jdtset', `The components of jdtset must be between 1 and 9999 (m_invars1.F90), found ${v}.`, jd.args[Math.min(i, jd.args.length - 1)] ?? jd.keySpan);
      }
    }
  }
  if (ndtset > 0 && ud && !jd) {
    const u = valuesOf(ud, 'int');
    if (u.length >= 2) {
      if (u[0] < 1 || u[0] > 999) report('error', 'abinit-udtset', `udtset(1) must be between 1 and 999 (m_invars1.F90), found ${u[0]}.`, ud.args[0] ?? ud.keySpan);
      else if (u[1] < 1 || u[1] > 9) report('error', 'abinit-udtset', `udtset(2) must be between 1 and 9 (m_invars1.F90), found ${u[1]}.`, ud.args[1] ?? ud.keySpan);
      else if (u[0] * u[1] !== ndtset) report('error', 'abinit-udtset', `udtset(1)*udtset(2) must be equal to ndtset (m_invars1.F90): ${u[0]}*${u[1]} = ${u[0] * u[1]}, but ndtset is ${ndtset}.`, ud.keySpan);
      else datasets = Array.from({ length: ndtset }, (_, i) => Math.floor(i / u[1] + 1) * 10 + (i % u[1]) + 1);
    }
  }
  const dsSet = new Set(datasets);

  // ---- every entry: suffix, duplicates, values, units
  const seen = new Map<string, AbinitEntry>();
  for (const e of doc.entries) {
    const v = e.variable;
    if (!v) continue;
    const k = e.kind;
    const id = e.image ? e.word.toLowerCase() : `${v.name}|${e.suffix}`;
    // m_parser.F90, intagm: "There are two occurrences of the keyword ... This is confusing, so it has been forbidden."
    if (seen.has(id)) report('error', 'abinit-duplicate', `${e.word} appears twice: ABINIT stops ("There are two occurrences of the keyword ... This is confusing, so it has been forbidden").`, e.keySpan);
    else seen.set(id, e);

    if (e.image && !/_(?:\d+img|lastimg)$/i.test(e.base)) {
      // m_parser.F90, intagm_img: the tokens read are name_1img, name_2img, ... and name_lastimg
      report('warning', 'abinit-suffix', `${e.word} is never read: for the images ABINIT looks for ${v.name}_1img, ${v.name}_2img, … and ${v.name}_lastimg (m_parser.F90, intagm_img).`, e.keySpan);
    } else if (k.kind === 'invalid') {
      report('warning', 'abinit-suffix', `${e.word}: ABINIT looks for ${e.base} followed by a dataset number (${e.base}1), ${e.base}?1, ${e.base}1?, or the series ${e.base}: ${e.base}+ ${e.base}*. This spelling is never read.`, e.keySpan);
    } else if (k.kind === 'dataset' && (k.index === 0 || e.suffix.startsWith('0'))) {
      // m_parser.F90, intagm: "an occurrence of the keyword appended with 0 in the input file. This is forbidden."
      report('error', 'abinit-dataset-zero', `${e.word}: a variable name appended with 0 is not allowed (dataset indices go from 1 to 9999).`, e.keySpan);
    } else if (ndtset === 0 && k.kind === 'dataset') {
      // m_parser.F90, intagm: "This is forbidden when ndtset == 0"; doc of ndtset: "input names with a dataset index are not allowed"
      report('error', 'abinit-no-ndtset', `${e.word} has a dataset index but ndtset is not set (or 0): ABINIT stops ("This is forbidden when ndtset == 0"). Set ndtset, or remove the digit.`, e.keySpan);
    } else if (ndtset === 0 && k.kind === 'series') {
      // m_parser.F90, intagm: "Although the multi-dataset mode is not activated, the keyword has been found appended with + * or :"
      report('error', 'abinit-no-ndtset', `${e.word}: the series syntax (: + *) needs the multi-dataset mode: ABINIT stops ("the multi-dataset mode is not activated"). Set ndtset.`, e.keySpan);
    } else if (ndtset === 0 && k.kind === 'wild') {
      report('warning', 'abinit-dataset-unused', `${e.word} is never read: ndtset is not set (or 0), so ABINIT does not use datasets.`, e.keySpan);
    } else if (ndtset > 0 && k.kind === 'dataset' && !dsSet.has(k.index)) {
      report('warning', 'abinit-dataset-unused', `${e.word} is never read: the datasets are ${listOf(datasets)}${jd || ud ? '' : ` (ndtset = ${ndtset})`}. ABINIT ignores a variable with a dataset index it does not run.`, e.keySpan);
    } else if (ndtset > 0 && k.kind === 'wild' && !datasets.some((d) => (k.unit !== undefined ? d % 10 === k.unit : Math.floor(d / 10) === k.tens))) {
      report('warning', 'abinit-dataset-unused', `${e.word} matches none of the datasets (${listOf(datasets)}).`, e.keySpan);
    }
    // These are read only for kptopt 1 to 4, so their values are checked below, with the datasets.
    if (!KPT_GATED.includes(v.name)) checkValues(e, report);
  }

  // m_parser.F90, intagm: the ?-forms for the units and for the tens digit of one dataset exclude each other.
  for (const d of datasets) {
    for (const list of byBase.values()) {
      const hits = list.filter((e) => e.kind.kind === 'wild' && (e.kind.unit !== undefined ? d % 10 === e.kind.unit : Math.floor(d / 10) === e.kind.tens));
      if (hits.length > 1 && d > 0) report('error', 'abinit-duplicate', `${hits[0].word} and ${hits[1].word} both apply to dataset ${d}: ABINIT stops ("cannot be used together in the input file"). Remove one of them.`, hits[1].keySpan);
    }
  }

  // ---- series (intagm): ":" once, with exactly one of "+" or "*"
  for (const [name, list] of byBase) {
    const series = list.filter((e) => e.kind.kind === 'series');
    if (!series.length || ndtset === 0) continue; // ndtset = 0 is reported above
    const ops = series.map((e) => (e.kind as { op: string }).op);
    const colon = ops.includes(':');
    const plus = ops.includes('+');
    const times = ops.includes('*');
    const at = series[0].keySpan;
    if (series.length < 2) {
      // intagm only runs for the variables ABINIT actually reads, so for these the message is a warning.
      if (colon) report('warning', 'abinit-series', `${name}: the series is started with "${series[0].word}" but there is no ${name}+ or ${name}* with the increment or factor: ABINIT stops when it reads ${name} (m_parser.F90, intagm: "initiate a series, but there is no occurrence of + or *").`, at);
      else report('warning', 'abinit-series', `${series[0].word} appears without ${name}: that starts the series: ABINIT stops when it reads ${name} (m_parser.F90, intagm: "does not appear in the input file ... This is forbidden").`, at);
    } else if (plus && times) {
      report('error', 'abinit-series', `${name}+ and ${name}* cannot be used together (m_parser.F90, intagm).`, series[1].keySpan);
    } else if (series.length > 2) {
      report('error', 'abinit-series', `${name} takes part in a series ${series.length} times; ABINIT allows it once with ":" and once with "+" or "*" (m_parser.F90, intagm).`, at);
    } else if (!colon) {
      report('error', 'abinit-series', `${series[0].word}: a series needs ${name}: for its first term (m_parser.F90, intagm).`, at);
    }
  }

  // ---- values of each dataset
  const includes = doc.includes.length > 0;
  const pick = (name: string, d: number): Pick => {
    const list = byBase.get(name);
    if (!list) return undefined;
    if (d > 0) {
      const exact = list.find((e) => e.kind.kind === 'dataset' && e.kind.index === d);
      if (exact) return exact;
      const wild = list.find((e) => e.kind.kind === 'wild' && (e.kind.unit !== undefined ? e.kind.unit === d % 10 : e.kind.tens === Math.floor(d / 10)));
      if (wild) return wild;
      if (list.some((e) => e.kind.kind === 'series')) return 'series';
    }
    return list.find((e) => e.kind.kind === 'plain');
  };
  /** Integer value of a scalar variable: undefined when absent, null when it cannot be known (series, unreadable). */
  const intAt = (name: string, d: number): number | undefined | null => {
    const p = pick(name, d);
    if (!p) return undefined;
    if (p === 'series') return null;
    const n = intOfEntry(p);
    return n === undefined ? null : n;
  };
  const realAt = (name: string, d: number): number | undefined | null => {
    const p = pick(name, d);
    if (!p) return undefined;
    if (p === 'series') return null;
    const t = p.args[0];
    if (!t) return null;
    const r = readAbinitValue(t.text, 'real');
    return r.error || r.value === undefined || !Number.isFinite(r.count) ? null : r.value;
  };
  const at = (e: Pick): Span => (e && e !== 'series' ? e.keySpan : start);
  const where = (d: number) => (d > 0 && ndtset > 0 ? ` (dataset ${d})` : '');

  const natomOf = (d: number) => intAt('natom', d);
  const ntypatOf = (d: number) => intAt('ntypat', d) ?? 1; // default 1 (documentation of ntypat)

  const dim = (spec: string, d: number): number | undefined => {
    if (/^\d+$/.test(spec)) return Number(spec);
    const get = (n: string): number | undefined => {
      if (n === 'natom') return numOrUndef(natomOf(d));
      if (n === 'natrd') return numOrUndef(intAt('natrd', d) ?? natomOf(d));
      if (n === 'ntypat') return numOrUndef(ntypatOf(d));
      if (n === 'npsp') return numOrUndef(intAt('npsp', 0) ?? ntypatOf(d));
      if (n === 'nshiftk') return numOrUndef(intAt('nshiftk', d) ?? 1);
      if (n === 'nkpt') return numOrUndef(intAt('nkpt', d) ?? 1); // kpt is read for kptopt = 0 only, where nkpt defaults to 1
      if (n === 'ndtset') return ndtset;
      return undefined;
    };
    return get(spec);
  };

  /** For the k-point variables: whether any dataset that applies the entry reads it (kptopt 1 to 4), per entry. */
  const kptUse = new Map<AbinitEntry, boolean>();
  for (const d of datasets) {
    const ds = where(d);
    // m_invars1.F90: "Input natom must be defined, but was absent for dataset"
    if (!includes && !pick('structure', d)) {
      const natomP = pick('natom', d);
      // m_invars1.F90 also takes natom from an xyz file (xyzfile)
      if (!natomP && !pick('xyzfile', d)) report('error', 'abinit-required', `natom is not set${ds}: ABINIT stops ("Input natom must be defined, but was absent").`, start);
      const nat = natomOf(d);
      if (typeof nat === 'number' && nat <= 0) report('error', 'abinit-natom', `natom must be > 0 (m_invars1.F90), found ${nat}${ds}.`, at(natomP));
      const nty = intAt('ntypat', d);
      if (typeof nty === 'number' && nty <= 0) report('error', 'abinit-natom', `ntypat must be > 0 (m_invars1.F90), found ${nty}${ds}.`, at(pick('ntypat', d)));
      // m_invars1.F90: "The array znucl MUST be initialized in the input file"
      if (!pick('znucl', d) && !pick('xyzfile', d)) report('error', 'abinit-required', `znucl is not set${ds}: ABINIT stops ("The array znucl MUST be initialized in the input file").`, start);
    }
    // m_invars2.F90: 'The input keyword "ecut" is compulsory !' (planewave runs, usewvl = 0)
    if (!includes && !pick('ecut', d) && intAt('usewvl', d) !== 1 && intAt('usewvl', d) !== null) {
      report('error', 'abinit-required', `ecut is not set${ds}: ABINIT stops ('The input keyword "ecut" is compulsory').`, start);
    }
    // m_ingeo.F90: "Neither xred nor xcart are present in input file" / "Too many input channels for atomic positions"
    const xr = pick('xred', d);
    const xc = pick('xcart', d);
    if (!includes && !pick('structure', d) && !pick('xyzfile', d)) {
      if (!xr && !xc && intAt('random_atpos', d) === undefined) report('error', 'abinit-required', `Neither xred nor xcart is set${ds}: ABINIT stops ("Neither xred nor xcart are present in input file").`, start);
    }
    if (xr && xc && xr !== 'series' && xc !== 'series') report('error', 'abinit-xred-xcart', `xred and xcart are both set${ds}: ABINIT stops ("Too many input channels for atomic positions are defined"). Keep one.`, xc.keySpan);
    // m_ingeo.F90, typat has no default for natom > 1 (the documentation gives 1 only for natom = 1).
    const natrd = dim('natrd', d);
    if (!includes && !pick('typat', d) && typeof natrd === 'number' && natrd > 1 && !GEOMETRY_ELSEWHERE.some((n) => n !== 'natrd' && pick(n, d))) {
      report('warning', 'abinit-typat-missing', `typat is not set${ds} while ${natrd} atoms are read: its default is 1 only for a single atom (documentation of typat).`, start);
    }

    // lengths of arrays (inarray: "Maybe a disagreement between the declared dimension of the array, and the number of items provided")
    for (const [name, dims] of Object.entries(COUNTED)) {
      const p = pick(name, d);
      if (!p || p === 'series') continue;
      if (name === 'kpt' && intAt('kptopt', d) !== 0) continue;
      if (['typat', 'xred', 'xcart', 'spinat'].includes(name) && GEOMETRY_ELSEWHERE.filter((n) => n !== 'natrd').some((n) => pick(n, d))) continue;
      const sizes = dims.map((s) => dim(s, d));
      if (sizes.some((n) => n === undefined)) continue;
      const need = sizes.reduce<number>((a, b) => a * (b ?? 0), 1);
      if (need <= 0) continue;
      checkCount(p, need, dims, name, report, ds, ndtset === 0);
    }

    // typat values: 1 … ntypat (m_ingeo.F90: "The input type of atom number ... while it should be between 1 and ntypat")
    const tp = pick('typat', d);
    const ntypat = intAt('ntypat', d) ?? 1;
    if (tp && tp !== 'series' && typeof ntypat === 'number' && !pick('structure', d)) {
      const need = dim('natrd', d);
      let seenCount = 0;
      for (const t of tp.args) {
        const r = readAbinitValue(t.text, 'int');
        if (r.error || r.value === undefined) break;
        if ((r.value < 1 || r.value > ntypat) && (need === undefined || seenCount < need)) {
          report('error', 'abinit-typat-range', `typat contains ${r.value}, but the types go from 1 to ntypat = ${ntypat} (m_ingeo.F90: "The input type of atom number ... should be between 1 and ntypat").`, t);
        }
        seenCount += Number.isFinite(r.count) ? r.count : 1;
      }
    }

    // k points (m_inkpts.F90)
    const kopt = intAt('kptopt', d);
    const ng = pick('ngkpt', d);
    const kl = pick('kptrlatt', d);
    if (kopt === undefined ? intAt('nspden', d) === undefined : kopt !== null) {
      const k = kopt ?? 1;
      if (k >= 1 && k <= 4) {
        if (ng && kl && ng !== 'series' && kl !== 'series') report('error', 'abinit-kpt', `ngkpt and kptrlatt cannot both be set${ds} (m_inkpts.F90: "The input variables ngkpt and kptrlatt cannot both be initialized").`, kl.keySpan);
        if (ng && ng !== 'series') {
          for (const t of ng.args.slice(0, 3)) {
            const r = readAbinitValue(t.text, 'int');
            if (!r.error && r.value !== undefined && r.value < 1) report('error', 'abinit-kpt', `ngkpt must be strictly positive (m_inkpts.F90), found ${r.value}.`, t);
          }
        }
        const nsk = intAt('nshiftk', d);
        // m_inkpts.F90: "The only allowed values of nshiftk are between 1 and MAX_NSHIFTK"
        if (typeof nsk === 'number' && nsk < 1) report('error', 'abinit-kpt', `nshiftk must be at least 1 (m_inkpts.F90), found ${nsk}${ds}.`, at(pick('nshiftk', d)));
        // m_inkpts.F90: "When nshiftk is not equal to 1, shiftk must be defined in the input file"
        if (typeof nsk === 'number' && nsk !== 1 && !pick('shiftk', d)) report('error', 'abinit-kpt', `nshiftk = ${nsk} but shiftk is not set${ds}: ABINIT stops ("When nshiftk is not equal to 1, shiftk must be defined in the input file").`, at(pick('nshiftk', d)));
      } else if (k > 4) {
        report('error', 'abinit-kpt', `kptopt = ${k} is not allowed${ds}: ABINIT stops ("The only values of kptopt allowed are smaller than 4", m_inkpts.F90).`, at(pick('kptopt', d)));
      }
      for (const n of ['ngkpt', 'kptrlatt', 'shiftk', 'nshiftk']) {
        const p = pick(n, d);
        if (p && p !== 'series') kptUse.set(p, (kptUse.get(p) ?? false) || (k >= 1 && k <= 4));
      }
      if (k < 0) {
        // m_inkpts.F90: "For a negative kptopt, iscf must be -2"
        const isc = intAt('iscf', d);
        if (isc !== null && (isc ?? 7) !== -2) report('error', 'abinit-kpt', `kptopt = ${k} (a band structure) needs iscf = -2${ds}, but iscf is ${isc ?? '7 (the default)'}: ABINIT stops ("For a negative kptopt, iscf must be -2", m_inkpts.F90).`, at(pick('iscf', d) ? pick('iscf', d) : pick('kptopt', d)));
        // m_inkpts.F90: "When kptopt is negative, kptbounds must be initialized" and "ndivsm or ndivk must be initialized"
        if (!pick('kptbounds', d)) report('error', 'abinit-kpt', `kptopt = ${k} (a band structure) needs kptbounds${ds}: ABINIT stops ("When kptopt is negative, kptbounds must be initialized").`, at(pick('kptopt', d)));
        const dk = pick('ndivk', d);
        const ds2 = pick('ndivsm', d);
        if (!dk && !ds2) report('error', 'abinit-kpt', `kptopt = ${k} needs ndivsm or ndivk${ds}: ABINIT stops ("When kptopt is negative, ndivsm or ndivk must be initialized").`, at(pick('kptopt', d)));
        if (dk && ds2) report('error', 'abinit-kpt', `ndivk and ndivsm are mutually exclusive (m_inkpts.F90): ABINIT stops. Keep one.`, at(ds2));
      }
    }

    // ionic motion (m_chkinp.F90)
    const ionmov = intAt('ionmov', d);
    if (typeof ionmov === 'number' && !IONMOV_VALUES.includes(ionmov)) report('error', 'abinit-ionmov', `ionmov = ${ionmov} is not an allowed value (m_chkinp.F90 accepts ${IONMOV_VALUES.join(', ')}).`, at(pick('ionmov', d)));
    const optcell = intAt('optcell', d);
    if (typeof optcell === 'number' && optcell !== 0 && !pick('imgmov', d) && ionmov !== null && !pick('geoopt', d) && !pick('moldyn', d)) {
      const im = ionmov ?? 0;
      if (!IONMOV_CELL.includes(im)) report('error', 'abinit-optcell', `optcell = ${optcell} optimizes the cell, which needs ionmov = ${IONMOV_CELL.join(', ')} (m_chkinp.F90), but ionmov is ${ionmov === undefined ? '0 (the default)' : im}${ds}.`, at(pick('optcell', d)));
    }
    // documentation of optforces: its default is 1 when toldff or tolrff differ from zero
    const optforces = intAt('optforces', d);
    const forcesTol = ['toldff', 'tolrff'].some((n) => {
      const v = realAt(n, d);
      return typeof v === 'number' && Math.abs(v) > 0;
    });
    if (forcesTol && typeof optforces === 'number' && optforces !== 1) {
      report('warning', 'abinit-optforces', `optforces = ${optforces} with toldff/tolrff${ds}: the forces are used as the SCF stopping criterion only with optforces = 1 (documentation of optforces; its default is 1 in that case).`, at(pick('optforces', d)));
    }

    checkTolerances(d, ds);
  }

  // The documentation of ngkpt/kptrlatt/shiftk/nshiftk and m_inkpts.F90: read only for kptopt 1 to 4.
  for (const [p, used] of kptUse) {
    if (used) checkValues(p, report);
    else report('warning', 'abinit-kpt-ignored', `${p.base} is ignored: it is read only when kptopt is 1 to 4, and every dataset that applies it has another kptopt (documentation of ${p.base}, m_inkpts.F90).`, p.keySpan);
  }

  // m_invars1.F90: without npsp, ntypat must be the same in all datasets
  if (!plainOf('npsp') && datasets.length > 1) {
    const values = datasets.map((d) => intAt('ntypat', d));
    if (values.every((n) => typeof n === 'number' || n === undefined) && new Set(values.map((n) => n ?? 1)).size > 1) {
      report('error', 'abinit-ntypat', 'ntypat differs between the datasets while npsp is not set: ABINIT stops ("When npsp is not defined, the input variable ntypat must be the same for all datasets"). Set npsp.', at(pick('ntypat', datasets[0]) ?? byBase.get('ntypat')?.[0]));
    }
  }

  // m_invars1.F90: the number of comma-separated pseudos must equal npsp
  const ps = plainOf('pseudos');
  if (ps && ps.args[0]?.text.startsWith('"') && !datasets.some((d) => pick('structure', d) || pick('xyzfile', d))) {
    const npsp = intAt('npsp', 0) ?? maxOf(datasets.map((d) => ntypatOf(d)));
    if (typeof npsp === 'number') {
      const n = (ps.args[0].text.match(/,/g) ?? []).length + 1;
      if (n !== npsp) report('error', 'abinit-pseudos', `pseudos lists ${n} file${n === 1 ? '' : 's'} but npsp (ntypat) is ${npsp}: ABINIT stops ("Not enough pseudopotentials in input pseudos string, expecting npsp"). Separate the files with commas.`, ps.args[0]);
    }
  }

  return out;

  // ------------------------------------------------------------------ helpers (closures over the document)

  function checkTolerances(d: number, ds: string) {
    // m_invars2.F90 (tolXXX read per dataset or generically) and m_chkinp.F90 ("one and only one of the input tolerance criteria")
    const od = intAt('optdriver', d);
    const iscf = intAt('iscf', d);
    if ((od !== undefined && od !== 0 && od !== 1) || od === null || iscf === null) return;
    const names = [...TOL_SCF, 'tolwfr'];
    const val: Record<string, { v: number; generic: boolean } | undefined> = {};
    for (const n of names) {
      const p = pick(n, d);
      if (p === 'series') return;
      if (!p) continue;
      const v = realAt(n, d);
      if (v === null || v === undefined) return;
      val[n] = { v, generic: p.kind.kind === 'plain' };
    }
    const nz = (n: string, generic: boolean) => {
      const x = val[n];
      return x && x.generic === generic && Math.abs(x.v) > Number.MIN_VALUE ? 1 : 0;
    };
    const itol = TOL_SCF.reduce((a, n) => a + nz(n, false), 0);
    const itolGen = TOL_SCF.reduce((a, n) => a + nz(n, true), 0);
    const first = TOL_SCF.map((n) => pick(n, d)).find((p): p is AbinitEntry => !!p && p !== 'series');
    if (itol > 1 || itolGen > 1) {
      report('error', 'abinit-tolerance', `More than one of ${TOL_SCF.join(', ')} is different from zero${ds}: ABINIT stops ("Only one of the tolXXX variables may be defined at once"). Keep one; tolwfr may be added to it.`, first?.keySpan ?? start);
      return;
    }
    const wfrSpecific = nz('tolwfr', false);
    const wfrGeneric = nz('tolwfr', true);
    // m_invars2.F90: tolwfr couples with another criterion only when both are given for the dataset, or both generically
    let tol = itol > 0 ? 1 : wfrSpecific ? 0 : itolGen;
    let wfr = wfrSpecific ? 1 : itol > 0 ? 0 : wfrGeneric;
    if (itol === 0 && wfrSpecific === 0 && itolGen === 0) tol = 0;
    if (itol === 1 && wfrSpecific === 0) wfr = 0;
    if (includes) return; // the criterion may be in the included file
    const accuracy = intAt('accuracy', d);
    if (accuracy === null || (typeof accuracy === 'number' && accuracy > 0)) return; // accuracy sets tolvrs
    if (iscf !== undefined && iscf < 0 && iscf !== -3) {
      if (!wfr) report('error', 'abinit-tolerance', `iscf = ${iscf} (non-self-consistent)${ds} needs tolwfr > 0, the only criterion available (m_chkinp.F90).`, at(pick('iscf', d)));
    } else if (!wfr && tol !== 1) {
      report('error', 'abinit-tolerance', `No SCF convergence criterion is set${ds}: m_chkinp.F90 stops ("For the SCF case, one and only one of the input tolerance criteria toldff, tolrff, toldfe, toldmag or tolvrs must differ from zero"). Set one, e.g. toldfe 1.0d-8 or tolvrs 1.0d-10.`, start);
    }
  }
}

function numOrUndef(n: number | undefined | null): number | undefined {
  return typeof n === 'number' ? n : undefined;
}
function maxOf(ns: (number | undefined | null)[]): number | undefined {
  const xs = ns.filter((n): n is number => typeof n === 'number');
  return xs.length === ns.length && xs.length ? Math.max(...xs) : undefined;
}
const listOf = (ds: number[]) => (ds.length > 8 ? `${ds.slice(0, 8).join(', ')}, …` : ds.join(', '));

/** The integers (or reals) of an entry, repeats expanded; stops at an unreadable token. */
function valuesOf(e: AbinitEntry, type: 'int' | 'real'): number[] {
  const out: number[] = [];
  for (const t of e.args) {
    const r = readAbinitValue(t.text, type);
    if (r.error || r.value === undefined || !Number.isFinite(r.count)) break;
    for (let i = 0; i < Math.min(r.count, 10000); i++) out.push(r.value);
  }
  return out;
}

/** Type and unit checks of one entry (inarray, inread). */
function checkValues(e: AbinitEntry, report: Report) {
  const v = e.variable!;
  if (v.type === 'string') {
    if (!ABINIT_QUOTED_STRINGS.has(v.name)) return;
    // m_parser.F90, intagm (KEY): "Cannot find first " defining string for token"
    if (!e.args[0] || !e.args[0].text.startsWith('"')) report('error', 'abinit-string', `${e.base} is a string: write its value in double quotes, e.g. ${e.base} "none". ABINIT stops ("Cannot find first \\" defining string for token").`, e.args[0] ?? e.keySpan);
    return;
  }
  if (v.type === 'integer or string') return;
  if (v.type === 'logical') return;
  const type = v.type === 'integer' ? 'int' : 'real';
  const isScalar = v.dims.length === 0;
  if (!e.args.length) {
    report('error', 'abinit-value', `${e.base} has no value: ABINIT reads the next word as its value and stops ("An error occurred reading data for keyword").`, e.keySpan);
    return;
  }
  // Scalars are read from their first value only; arrays are checked for their length against the other variables.
  const toRead = isScalar ? e.args.slice(0, 1) : e.args;
  for (const t of toRead) {
    if (t.text.startsWith('"')) {
      report('error', 'abinit-value', `${e.base} is not a string variable: a quoted value cannot be read as ${v.type === 'integer' ? 'an integer' : 'a number'}.`, t);
      break;
    }
    const r = readAbinitValue(t.text, type);
    if (r.error) {
      report('error', 'abinit-value', `${e.base}: ${r.error} (ABINIT: "An error occurred reading data for keyword")${type === 'int' && /\./.test(t.text) ? '. Integer variables cannot take a decimal point' : ''}.`, t);
      break;
    }
  }
}

/** Compares the number of values of an array with its dimensions (inarray: too few stops ABINIT, extra ones are ignored). */
function checkCount(e: AbinitEntry, need: number, dims: string[], name: string, report: Report, ds: string, warnExtra: boolean) {
  const type = e.variable!.type === 'integer' ? 'int' : 'real';
  let have = 0;
  let fills = false;
  for (const t of e.args) {
    const r = readAbinitValue(t.text, type);
    if (r.error) return; // reported by checkValues
    if (!Number.isFinite(r.count)) {
      fills = true;
      break;
    }
    have += r.count;
    if (have >= need) break;
  }
  const spec = dims.length > 1 || !/^\d+$/.test(dims[0]) ? ` (${dims.join(' x ')})` : '';
  if (!fills && have < need) {
    report('error', 'abinit-count', `${name} needs ${need} values${spec}${ds}, found ${have}: ABINIT reads the next word as a value and stops ("Maybe a disagreement between the declared dimension of the array, and the number of items provided").`, e.args.length ? { start: e.args[0].start, end: e.args[e.args.length - 1].end } : e.keySpan);
    return;
  }
  // Values beyond the dimension are not read. With datasets, one array shared by datasets of different sizes is common (tutorial tbase2_1).
  if (!warnExtra) return;
  let total = 0;
  for (const [i, t] of e.args.entries()) {
    const r = readAbinitValue(t.text, type);
    if (!Number.isFinite(r.count)) return;
    total += r.count;
    if (total > need) {
      report('warning', 'abinit-extra-values', `${name} reads ${need} value${need === 1 ? '' : 's'}${spec}${ds}, but more follow: ABINIT ignores the extra ones silently. Is the dimension (${dims.join(' x ')}) what you meant?`, { start: t.start, end: e.args[e.args.length - 1].end });
      return;
    }
    if (total === need && i < e.args.length - 1) {
      const rest = e.args.slice(i + 1);
      report('warning', 'abinit-extra-values', `${name} reads ${need} value${need === 1 ? '' : 's'}${spec}${ds}, but ${rest.length} more follow: ABINIT ignores the extra ones silently. Is the dimension (${dims.join(' x ')}) what you meant?`, { start: rest[0].start, end: rest[rest.length - 1].end });
      return;
    }
  }
}
