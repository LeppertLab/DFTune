// The CASTEP languages for the input-language framework of inputLanguages.ts: lint (with the other file of the
// seed), Format Document, hover and completion for `<seed>.cell` and `<seed>.param`.

import type * as vscode from 'vscode';
import { castepCompletions, castepHover, formatCastep, parseCastep, validateCastep, type CastepCompletion, type CastepFile, type Diagnostic } from '../core';
import { findCastepNeighbor } from './castepSiblings';

export interface CastepLanguage {
  id: string;
  label: string;
  lint: (text: string, uri: vscode.Uri) => Promise<Diagnostic[]>;
  format: (text: string) => string | undefined;
  hover: (text: string, offset: number, uri: vscode.Uri) => Promise<{ markdown: string; start: number; end: number } | undefined>;
  complete: (text: string, offset: number, uri: vscode.Uri) => CastepCompletion[];
  triggers: string[];
}

const language = (file: CastepFile): CastepLanguage => ({
  id: `castep-${file}`,
  label: `CASTEP .${file}`,
  lint: async (text, uri) => validateCastep(parseCastep(text), file, { neighbor: await findCastepNeighbor(uri) }),
  format: formatCastep,
  hover: async (text, offset) => castepHover(parseCastep(text), file, offset),
  complete: (text, offset) => castepCompletions(parseCastep(text), file, offset),
  triggers: [':', '=', ' ', '%'],
});

export const CASTEP_LANGUAGES: CastepLanguage[] = [language('cell'), language('param')];
