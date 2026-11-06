import * as vscode from 'vscode';
import { INTENTS, KPOINT_DENSITIES, automaticGrid, cardsOf, kpointsCard, kspacingMesh, meshKpoints, newIncar, parseQe, qeCell, readPoscar, setKpointsCard, type PoscarInfo } from '../core';
import { VIEW_TYPE } from './incarEditor';
import { BGW_VIEW_TYPE } from './bgwEditor';
import { QE_VIEW_TYPE } from './qeEditor';
import { findPoscar, siblingName } from './inputs';

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('dftune.openBuilder', openBuilder),
    vscode.commands.registerCommand('dftune.openQeBuilder', openQeBuilder),
    vscode.commands.registerCommand('dftune.openBgwBuilder', openBgwBuilder),
    vscode.commands.registerCommand('dftune.newCalculation', newCalculation),
    vscode.commands.registerCommand('dftune.generateKpoints', generateKpoints),
  );
}

async function openBuilder(uri?: vscode.Uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage('Open an INCAR file first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, vscode.ViewColumn.Beside);
}

async function openQeBuilder(uri?: vscode.Uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage('Open a Quantum ESPRESSO input first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, QE_VIEW_TYPE, vscode.ViewColumn.Beside);
}

async function openBgwBuilder(uri?: vscode.Uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage('Open a BerkeleyGW input first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, BGW_VIEW_TYPE, vscode.ViewColumn.Beside);
}

/** Asks for the main intents and writes a commented INCAR into the chosen folder. */
async function newCalculation(folder?: vscode.Uri) {
  folder ??= await pickFolder();
  if (!folder) return;

  const choices: Record<string, string> = {};
  for (const kind of INTENTS) {
    const pick = await vscode.window.showQuickPick(
      kind.choices.map((c) => ({ label: c.label, description: c.description, id: c.id })),
      { title: `New VASP calculation: ${kind.label}`, placeHolder: kind.label, ignoreFocusOut: true },
    );
    if (!pick) return;
    choices[kind.id] = pick.id;
  }

  const incar = vscode.Uri.joinPath(folder, 'INCAR');
  const poscar = await findPoscar(incar);
  const kpoints = await pickKpointsSetup(poscar?.info, await exists(vscode.Uri.joinPath(folder, 'KPOINTS')));
  if (!kpoints) return;

  if (await exists(incar)) {
    const answer = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(incar)} already exists. Replace it?`, { modal: true }, 'Replace');
    if (answer !== 'Replace') return;
  }
  const system = poscar?.info.comment || folder.path.split('/').pop() || 'calculation';
  let text = newIncar(system, choices);
  if (kpoints.kind === 'kspacing') text += `\n# k points: spacing ${kpoints.spacing} 1/A\nKSPACING = ${kpoints.spacing}\n`;
  await vscode.workspace.fs.writeFile(incar, new TextEncoder().encode(text));
  if (kpoints.kind === 'file' && poscar?.info.lattice && poscar.info.volume) {
    // Replacing an existing KPOINTS was chosen in the k-points pick, so it is not asked again.
    await writeKpoints(vscode.Uri.joinPath(folder, 'KPOINTS'), meshKpoints({ lattice: poscar.info.lattice, volume: poscar.info.volume }, kpoints.spacing), true);
  }

  await vscode.window.showTextDocument(incar, { viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('vscode.openWith', incar, VIEW_TYPE, vscode.ViewColumn.Beside);
}

type KpointsSetup = { kind: 'file' | 'kspacing'; spacing: number } | { kind: 'none' };

/** How the new calculation gets its k points; undefined when cancelled. */
async function pickKpointsSetup(poscar: PoscarInfo | undefined, hasKpoints: boolean): Promise<KpointsSetup | undefined> {
  const hasCell = !!(poscar?.lattice && poscar.volume);
  const items: (vscode.QuickPickItem & { setup: KpointsSetup['kind'] })[] = hasKpoints
    ? [
        // VASP ignores KSPACING when there is a KPOINTS file, so that is not offered here.
        { setup: 'none', label: 'Keep the existing KPOINTS', description: 'VASP takes the k points from it' },
        ...(hasCell ? [{ setup: 'file' as const, label: 'Replace KPOINTS', description: 'with a Γ-centred mesh for the POSCAR in this folder' }] : []),
      ]
    : [
        ...(hasCell ? [{ setup: 'file' as const, label: 'KPOINTS file', description: 'Γ-centred mesh for the POSCAR in this folder' }] : []),
        { setup: 'kspacing', label: 'KSPACING in the INCAR', description: 'VASP builds the mesh from a k-point spacing' },
        { setup: 'none', label: 'Not now', description: hasCell ? 'add k points later' : 'no POSCAR here, so no KPOINTS file can be generated' },
      ];
  const pick = await vscode.window.showQuickPick(items, { title: 'New VASP calculation: k points', ignoreFocusOut: true });
  if (!pick) return undefined;
  if (pick.setup === 'none') return { kind: 'none' };
  const spacing = await pickDensity(poscar, `New VASP calculation: k-point density (${pick.label})`);
  return spacing === undefined ? undefined : { kind: pick.setup, spacing };
}

/** A k-point spacing, with the resulting mesh for the POSCAR when it is known. */
async function pickDensity(source: { lattice?: PoscarInfo['lattice']; volume?: number } | undefined, title: string): Promise<number | undefined> {
  const cell = source?.lattice && source.volume ? { lattice: source.lattice, volume: source.volume } : undefined;
  const pick = await vscode.window.showQuickPick(
    KPOINT_DENSITIES.map((d) => {
      const mesh = cell && kspacingMesh(cell, d.spacing);
      return {
        spacing: d.spacing,
        label: `${d.label}: ${d.spacing} Å⁻¹`,
        description: mesh ? `${mesh.join(' × ')} (${mesh[0] * mesh[1] * mesh[2]} k points)` : undefined,
        detail: d.description,
      };
    }),
    { title, placeHolder: 'Spacing between k points (2π included, as KSPACING)', ignoreFocusOut: true },
  );
  return pick?.spacing;
}

/** Writes a KPOINTS file, asking before replacing one, and opens it. */
async function writeKpoints(target: vscode.Uri, text: string, alreadyConfirmed = false): Promise<boolean> {
  if (!alreadyConfirmed && (await exists(target))) {
    const answer = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(target)} already exists. Replace it?`, { modal: true }, 'Replace');
    if (answer !== 'Replace') return false;
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(target, { preview: false, preserveFocus: true, viewColumn: vscode.ViewColumn.Beside });
  return true;
}

/**
 * Writes a Γ-centred KPOINTS for a POSCAR: run on a folder, a POSCAR, or any input file (then the
 * POSCAR and KPOINTS that belong to it, e.g. KPOINTS.relax for INCAR.relax).
 */
async function generateKpoints(uri?: vscode.Uri) {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source) {
    vscode.window.showInformationMessage('Open a POSCAR, INCAR, KPOINTS or Quantum ESPRESSO input (or pick a folder) first.');
    return;
  }
  const isFolder = (await vscode.workspace.fs.stat(source)).type === vscode.FileType.Directory;
  if (!isFolder) {
    const document = await vscode.workspace.openTextDocument(source);
    if (document.languageId === 'qe') return generateQeKpoints(document);
  }
  const anchor = isFolder ? vscode.Uri.joinPath(source, 'INCAR') : source;
  // Run on a structure file (CONTCAR, Si.vasp, POSCAR.relax): use that file itself.
  const poscar = (isStructureFile(anchor) ? await readStructure(anchor) : undefined) ?? (await findPoscar(anchor));
  if (!poscar?.info.lattice || !poscar.info.volume) {
    vscode.window.showWarningMessage(poscar ? `${poscar.fileName} could not be read completely: fix its problems first.` : 'No POSCAR found for this file.');
    return;
  }
  const spacing = await pickDensity(poscar.info, `KPOINTS for ${poscar.fileName}`);
  if (spacing === undefined) return;
  const target = vscode.Uri.joinPath(anchor, '..', siblingName(anchor, 'KPOINTS'));
  await writeKpoints(target, meshKpoints({ lattice: poscar.info.lattice, volume: poscar.info.volume }, spacing));
}

/** Puts a K_POINTS {automatic} card for the cell of a pw.x input into it, at a density the user picks. */
async function generateQeKpoints(document: vscode.TextDocument) {
  const qe = parseQe(document.getText(), { cards: cardsOf('pw') });
  const cell = qeCell(qe);
  if (!cell || 'error' in cell) {
    vscode.window.showWarningMessage(cell ? `The cell of this input cannot be built: ${cell.error}.` : 'The cell of this input could not be read: set ibrav (and celldm or A, or CELL_PARAMETERS) first.');
    return;
  }
  const spacing = await pickDensity(cell, `K_POINTS for ${vscode.workspace.asRelativePath(document.uri)}`);
  if (spacing === undefined) return;
  const edit = setKpointsCard(qe, kpointsCard(automaticGrid(cell, spacing)));
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
  await vscode.workspace.applyEdit(workspaceEdit);
}

function isStructureFile(uri: vscode.Uri): boolean {
  const name = (uri.path.split('/').pop() ?? '').toUpperCase();
  return name.startsWith('POSCAR') || name.startsWith('CONTCAR') || name.endsWith('.VASP') || name.endsWith('.POSCAR');
}

async function readStructure(uri: vscode.Uri): Promise<{ fileName: string; info: PoscarInfo } | undefined> {
  try {
    const info = readPoscar(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    return info && { fileName: uri.path.split('/').pop() ?? 'POSCAR', info };
  } catch {
    return undefined;
  }
}

async function pickFolder(): Promise<vscode.Uri | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    defaultUri: active ? vscode.Uri.joinPath(active, '..') : vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: 'Create INCAR here',
  });
  return picked?.[0];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
