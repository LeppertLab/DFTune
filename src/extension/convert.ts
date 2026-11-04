// Commands that convert between POSCAR and Quantum ESPRESSO inputs.

import * as vscode from 'vscode';
import { KPOINT_DENSITIES, kspacingMesh, parsePoscar, parseQe, cardsOf, parseUpf, poscarToQe, qeStructure, qeToPoscar, type QeCalculation } from '../core';

export function registerConvertCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('dftune.poscarToQe', poscarToQe_),
    vscode.commands.registerCommand('dftune.qeToPoscar', qeToPoscar_),
  );
}

/** The pseudopotential files of a directory, by element: `Fe.pbe-spn-kjpaw_psl.0.2.1.UPF`, `Fe_ONCV_PBE-1.0.upf`, … */
async function pseudosByElement(dir: vscode.Uri, elements: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let names: string[];
  try {
    names = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name).filter((n) => /\.upf$/i.test(n)).sort();
  } catch {
    return found;
  }
  for (const element of elements) {
    // The symbol followed by a separator, so that "F" does not match "Fe.pbe…".
    const own = names.filter((n) => new RegExp(`^${element}[._-]`, 'i').test(n));
    const best = own.find((n) => /pbe/i.test(n)) ?? own[0];
    if (best) found.set(element, best);
  }
  return found;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeAndOpen(target: vscode.Uri, text: string): Promise<void> {
  if (await exists(target)) {
    const answer = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(target)} already exists. Replace it?`, { modal: true }, 'Replace');
    if (answer !== 'Replace') return;
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(target, { preview: false });
}

async function poscarToQe_(uri?: vscode.Uri) {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source) {
    vscode.window.showInformationMessage('Open a POSCAR first.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(source);
  const parsed = parsePoscar(document.getText());
  const structure = parsed.structure;
  if (!structure || parsed.diagnostics.some((d) => d.severity === 'error')) {
    vscode.window.showWarningMessage('The POSCAR has problems (see the Problems panel): fix them first.');
    return;
  }
  if (!structure.species) {
    vscode.window.showWarningMessage('This POSCAR has no line with element names (VASP 4 format): add it first, QE needs to know the elements.');
    return;
  }

  const calc = await vscode.window.showQuickPick(
    [
      { label: 'scf', description: 'single self-consistent calculation', value: 'scf' as QeCalculation },
      { label: 'relax', description: 'relax the atomic positions', value: 'relax' as QeCalculation },
      { label: 'vc-relax', description: 'relax positions and cell', value: 'vc-relax' as QeCalculation },
    ],
    { title: 'Quantum ESPRESSO input from POSCAR: calculation', ignoreFocusOut: true },
  );
  if (!calc) return;
  const density = await vscode.window.showQuickPick(
    KPOINT_DENSITIES.map((d) => {
      const mesh = kspacingMesh(structure, d.spacing);
      return { label: `${d.label}: ${d.spacing} Å⁻¹`, description: `${mesh.join(' × ')} (${mesh[0] * mesh[1] * mesh[2]} k points)`, detail: d.description, spacing: d.spacing };
    }),
    { title: 'Quantum ESPRESSO input from POSCAR: k-point density', ignoreFocusOut: true },
  );
  if (!density) return;

  // Pseudopotentials from $ESPRESSO_PSEUDO (or ~/espresso/pseudo), when that directory exists.
  const pseudoPath = process.env.ESPRESSO_PSEUDO || (process.env.HOME ? `${process.env.HOME}/espresso/pseudo` : undefined);
  const pseudoDir = pseudoPath ? source.with({ path: pseudoPath }) : undefined;
  const elements = [...new Set(structure.species.map((s) => s.split(/[/_]/)[0]))];
  const pseudos = pseudoDir ? await pseudosByElement(pseudoDir, elements) : new Map<string, string>();
  // The cutoffs the pseudopotentials suggest, when they say.
  let ecutwfc: number | undefined;
  let ecutrho: number | undefined;
  for (const file of pseudos.values()) {
    try {
      const info = parseUpf(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(pseudoDir!, file))));
      if (info?.suggestedEcutwfc) ecutwfc = Math.max(ecutwfc ?? 0, info.suggestedEcutwfc);
      if (info?.suggestedEcutrho) ecutrho = Math.max(ecutrho ?? 0, info.suggestedEcutrho);
    } catch {
      // unreadable: no suggestion from this one
    }
  }

  const name = parsed.lines[0]?.text.trim() || source.path.split('/').pop() || 'calculation';
  const text = poscarToQe(structure, parsed.lines[0]?.text.trim() ?? '', {
    calculation: calc.value,
    name,
    spacing: density.spacing,
    pseudoFor: (element) => pseudos.get(element),
    pseudoDir: pseudos.size && pseudoPath ? pseudoPath : undefined,
    ecutwfc,
    ecutrho,
  });
  if (!text) return;
  await writeAndOpen(vscode.Uri.joinPath(source, '..', `${calc.label}.in`), text);
}

async function qeToPoscar_(uri?: vscode.Uri) {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source) {
    vscode.window.showInformationMessage('Open a Quantum ESPRESSO input first.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(source);
  const structure = qeStructure(parseQe(document.getText(), { cards: cardsOf('pw') }));
  if (!structure) {
    vscode.window.showWarningMessage('The structure of this input could not be read (cell, or atoms in ATOMIC_POSITIONS): see the Problems panel.');
    return;
  }
  const text = qeToPoscar(structure, source.path.split('/').pop() ?? '');
  if (!text) {
    vscode.window.showWarningMessage('Some species labels are not element symbols (e.g. X1): a POSCAR needs the elements.');
    return;
  }
  await writeAndOpen(vscode.Uri.joinPath(source, '..', 'POSCAR'), text);
}
