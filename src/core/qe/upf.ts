// Reads the header of a Unified Pseudopotential Format (UPF) file: which element, what kind of
// pseudopotential, which functional, how many valence electrons, and the cutoffs the generator
// suggests. Only the header is read; the potential data is never needed.
//
// UPF 2 puts these in attributes of <PP_HEADER .../>; the older UPF 1 has a fixed block of lines.

export interface UpfInfo {
  format: 'upf1' | 'upf2';
  element?: string;
  /** `NC` norm-conserving, `US` ultrasoft, `PAW`; anything else as written (e.g. `1/r`, `SL`). */
  type?: string;
  /** Exchange-correlation functional as written in the file (e.g. "SLA PW PBX PBC" or "PBE"). */
  functional?: string;
  zValence?: number;
  coreCorrection?: boolean;
  spinOrbit?: boolean;
  /** Suggested minimum cutoffs in Ry, when the generator wrote them in PP_INFO. */
  suggestedEcutwfc?: number;
  suggestedEcutrho?: number;
}

const flag = (v: string | undefined) => (v === undefined ? undefined : /^\s*(t|\.true\.|true)/i.test(v));

/** The header of a UPF file; undefined if the text is not UPF. */
export function parseUpf(text: string): UpfInfo | undefined {
  const head = text.slice(0, 200_000);
  const info = head.match(/<PP_INFO>([\s\S]*?)<\/PP_INFO>/)?.[1] ?? '';
  const suggested = {
    suggestedEcutwfc: number(info.match(/Suggested minimum cutoff for wavefunctions:\s*([\d.]+)/i)?.[1]),
    suggestedEcutrho: number(info.match(/Suggested minimum cutoff for charge density:\s*([\d.]+)/i)?.[1]),
  };

  const v2 = head.match(/<PP_HEADER\b([^>]*?)\/?>/);
  if (v2 && /=/.test(v2[1])) {
    const attr = Object.fromEntries([...v2[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2].trim()]));
    return {
      format: 'upf2',
      element: attr.element || undefined,
      type: attr.pseudo_type || (flag(attr.is_paw) ? 'PAW' : flag(attr.is_ultrasoft) ? 'US' : undefined),
      functional: attr.functional || undefined,
      zValence: number(attr.z_valence),
      coreCorrection: flag(attr.core_correction),
      spinOrbit: flag(attr.has_so),
      ...suggested,
    };
  }

  const v1 = head.match(/<PP_HEADER>([\s\S]*?)<\/PP_HEADER>/);
  if (v1) {
    const lines = v1[1].split('\n').map((l) => l.trim()).filter(Boolean);
    const find = (re: RegExp) => lines.find((l) => re.test(l));
    const element = find(/\bElement\b/i)?.split(/\s+/)[0];
    const typeLine = find(/Norm\s*-?\s*Conserving|Ultrasoft|\bPAW\b|Projector Augmented/i) ?? '';
    const type = /PAW|Projector Augmented/i.test(typeLine) ? 'PAW' : /Ultrasoft/i.test(typeLine) || /^US\b/.test(typeLine) ? 'US' : /Norm|^NC\b/i.test(typeLine) ? 'NC' : undefined;
    const functional = find(/Exchange-Correlation/i)?.replace(/\s*Exchange-Correlation.*$/i, '').trim();
    return {
      format: 'upf1',
      element,
      type,
      functional,
      zValence: number(find(/Z valence/i)?.split(/\s+/)[0]),
      coreCorrection: flag(find(/Nonlinear Core Correction/i)?.split(/\s+/)[0]),
      ...suggested,
    };
  }
  return undefined;
}

function number(s: string | undefined): number | undefined {
  const n = s === undefined ? NaN : Number(s.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A key for the exchange-correlation functional, so that the many spellings of one functional
 * agree: UPF 2 writes "PBE", UPF 1 "SLA PW PBX PBC" or "SLA PW PBE PBE", and so on.
 */
export function functionalKey(functional: string | undefined): string | undefined {
  if (!functional) return undefined;
  const f = functional.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const tokens = new Set(f.split(' '));
  const has = (...t: string[]) => t.every((x) => tokens.has(x));
  if (tokens.has('PBESOL') || has('PSX', 'PSC') || has('PSX') ) return 'PBESOL';
  if (tokens.has('PBE') || has('PBX', 'PBC') || has('PBX')) return 'PBE';
  if (tokens.has('REVPBE') || has('RPB')) return 'REVPBE';
  if (has('LYP') && (tokens.has('B88') || tokens.has('BLYP'))) return 'BLYP';
  if (tokens.has('PW91') || has('GGX', 'GGC')) return 'PW91';
  if (tokens.has('PZ') && !has('PBX')) return 'PZ';
  if (f === 'LDA') return 'PZ';
  if (tokens.has('SLA') && tokens.has('PW') && tokens.size <= 4 && !tokens.has('PBX') && !tokens.has('PBC')) return 'PW';
  return f;
}
