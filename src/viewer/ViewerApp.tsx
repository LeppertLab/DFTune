// The structure viewer: a toolbar, the 3D view and a legend. The file's text comes from the
// extension; the structure is read here with the same core code as the checks.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToWebviewStructure } from '../extension/messages';
import type { Vec3 } from '../core/poscar/parse';
import { describeCell } from '../core/qe/structure';
import { elementColor } from '../core/structure/elementData';
import { buildScene, composition, DEFAULT_SCENE, readStructure, type ViewStructure } from '../core/structure/view';
import { loadUiState, vscode } from '../webview/vscode';
import { StructureRenderer } from './renderer';

interface UiState {
  bonds: boolean;
  boundary: boolean;
  cell: boolean;
  repeat: Vec3;
  atomScale: number;
}

const DEFAULT_UI: UiState = { bonds: true, boundary: true, cell: true, repeat: [1, 1, 1], atomScale: 1 };

type Update = Extract<ToWebviewStructure, { type: 'update-structure' }>;

const fmt = (x: number, d = 4) => Number(x.toFixed(d)).toString();

export function ViewerApp() {
  const [message, setMessage] = useState<Update>();
  /** Offset of the cursor in the text editor. */
  const [cursor, setCursor] = useState<number>();
  const [ui, setUi] = useState<UiState>(() => loadUiState(DEFAULT_UI));
  const [hover, setHover] = useState<{ index: number; x: number; y: number }>();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<StructureRenderer>();
  const fitted = useRef<string>();
  const down = useRef<{ x: number; y: number }>();
  /** The atom rotation was last centred on, and where it was. */
  const focused = useRef<{ atom: number; at: string }>();

  useEffect(() => {
    const onMessage = (e: MessageEvent<ToWebviewStructure>) => {
      if (e.data?.type === 'update-structure') setMessage(e.data);
      else if (e.data?.type === 'select-structure') setCursor(e.data.offset);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    vscode.setState(ui);
  }, [ui]);

  const structure = useMemo(() => (message ? readStructure(message.text, message.format, message.speciesHint) : undefined), [message]);
  const ok = structure && !('error' in structure) ? structure : undefined;
  const scene = useMemo(
    () => ok && buildScene(ok, { ...DEFAULT_SCENE, bonds: ui.bonds, boundary: ui.boundary, repeat: ui.repeat }),
    [ok, ui.bonds, ui.boundary, ui.repeat],
  );

  useEffect(() => {
    if (!ok || !host.current) return;
    renderer.current ??= new StructureRenderer(host.current);
  }, [ok]);
  useEffect(() => () => renderer.current?.dispose(), []);

  useEffect(() => {
    if (!ok || !scene || !renderer.current) return;
    // Refit when the supercell changes; keep the view while the file is edited.
    const fitKey = ui.repeat.join('x');
    const refit = fitted.current !== fitKey;
    renderer.current.set(ok, scene, { repeat: ui.repeat, cell: ui.cell, atomScale: ui.atomScale }, refit);
    if (refit) focused.current = undefined; // centre on the selected atom again below
    fitted.current = fitKey;
    setHover(undefined);
  }, [ok, scene, ui.cell, ui.atomScale, ui.repeat]);

  // The atom on the cursor's line, and its copy in the first cell of the scene.
  const selected = useMemo(() => {
    const i = cursor === undefined || !ok ? -1 : ok.atoms.findIndex((a) => cursor >= a.start && cursor <= a.end);
    return i < 0 ? undefined : i;
  }, [ok, cursor]);
  const selectedIndex = scene && selected !== undefined ? scene.atoms.findIndex((a) => a.atom === selected && !a.image) : -1;

  useEffect(() => {
    renderer.current?.setSelected(selectedIndex < 0 ? undefined : selectedIndex, ui.atomScale);
  }, [scene, selectedIndex, ui.atomScale]);

  // Moving the cursor to another atom centres rotation on it, and editing that atom's coordinates
  // (or the cell) moves the centre along with it; the angle and zoom stay as they are. Other edits
  // keep the centre where it is.
  useEffect(() => {
    const cart = selectedIndex >= 0 && scene ? scene.atoms[selectedIndex].cart : undefined;
    if (selected === undefined || !cart) {
      focused.current = undefined;
      return;
    }
    const at = cart.join(' ');
    if (focused.current?.atom === selected && focused.current.at === at) return;
    focused.current = { atom: selected, at };
    renderer.current?.focusOn(cart);
  }, [selected, selectedIndex, scene]);

  if (!message) return <div className="loading">Loading…</div>;
  const set = <K extends keyof UiState>(key: K, value: UiState[K]) => setUi((u) => ({ ...u, [key]: value }));
  const hovered = hover && scene?.atoms[hover.index];

  const onMove = (e: React.PointerEvent) => {
    if (e.buttons) return; // rotating
    const index = renderer.current?.pick(e.clientX, e.clientY);
    renderer.current?.setHighlight(index, ui.atomScale);
    const rect = host.current!.getBoundingClientRect();
    setHover(index === undefined ? undefined : { index, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const onClick = (e: React.PointerEvent) => {
    const start = down.current;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || !ok || !scene) return;
    const index = renderer.current?.pick(e.clientX, e.clientY);
    if (index === undefined) return;
    const atom = ok.atoms[scene.atoms[index].atom];
    vscode.postMessage({ type: 'reveal', offset: atom.start, end: atom.end });
  };

  return (
    <div className="viewer">
      <div className="viewer-head">
        <h1>{message.fileName}</h1>
        {ok && <Summary structure={ok} />}
      </div>
      {!ok ? (
        <p className="viewer-error">{structure && 'error' in structure ? structure.error : ''}</p>
      ) : (
        <>
          <div className="viewer-toolbar">
            <label>
              <input type="checkbox" checked={ui.bonds} onChange={(e) => set('bonds', e.target.checked)} />
              Bonds
            </label>
            <label title="Also draw the periodic images of atoms on a face, edge or corner of the cell">
              <input type="checkbox" checked={ui.boundary} onChange={(e) => set('boundary', e.target.checked)} />
              Boundary atoms
            </label>
            <label>
              <input type="checkbox" checked={ui.cell} onChange={(e) => set('cell', e.target.checked)} />
              Unit cell
            </label>
            <span className="repeat" title="Supercell: repetitions along a, b and c">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="number"
                  min={1}
                  max={6}
                  aria-label={`Repetitions along ${'abc'[i]}`}
                  value={ui.repeat[i]}
                  onChange={(e) => {
                    const n = Math.min(6, Math.max(1, Math.round(Number(e.target.value) || 1)));
                    set('repeat', ui.repeat.map((r, j) => (j === i ? n : r)) as Vec3);
                  }}
                />
              ))}
            </span>
            <label title="Atom size">
              Size
              <input type="range" min={0.4} max={2} step={0.1} value={ui.atomScale} onChange={(e) => set('atomScale', Number(e.target.value))} />
            </label>
            <span className="views">
              {(['a', 'b', 'c'] as const).map((axis, i) => (
                <button key={axis} className="secondary" title={`Look down ${axis}`} onClick={() => renderer.current?.viewAlong(i as 0 | 1 | 2)}>
                  {axis}
                </button>
              ))}
              <button className="secondary" onClick={() => renderer.current?.resetView()}>
                Reset view
              </button>
            </span>
          </div>
          {scene?.bondsSkipped && <p className="muted">Bonds are not drawn for this many atoms.</p>}
        </>
      )}
      <div
        className="viewer-canvas"
        ref={host}
        hidden={!ok}
        onPointerMove={onMove}
        onPointerLeave={() => {
          renderer.current?.setHighlight(undefined, ui.atomScale);
          setHover(undefined);
        }}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={onClick}
      >
        {hovered && ok && hover && (
          <div className="atom-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <AtomTip structure={ok} atom={hovered.atom} frac={hovered.frac} cart={hovered.cart} image={hovered.image} />
          </div>
        )}
      </div>
      {ok && (
        <div className="legend">
          {composition(ok).map(({ element }) => (
            <span key={element}>
              <i style={{ background: elementColor(element) }} />
              {element}
            </span>
          ))}
          <span className="muted">Drag to rotate, right-drag to pan, scroll to zoom. Click an atom to go to its line; the atom on the cursor's line is the centre of rotation.</span>
        </div>
      )}
    </div>
  );
}

function Summary({ structure }: { structure: ViewStructure }) {
  const formula = composition(structure)
    .map(({ element, count }) => `${element}${count > 1 ? count : ''}`)
    .join('');
  const n = structure.atoms.length;
  return (
    <p className="muted">
      {structure.title && `${structure.title} · `}
      {formula} · {n} atom{n === 1 ? '' : 's'}
      <br />
      {describeCell(structure.lattice, structure.volume)}
    </p>
  );
}

function AtomTip({ structure, atom, frac, cart, image }: { structure: ViewStructure; atom: number; frac: Vec3; cart: Vec3; image: boolean }) {
  const a = structure.atoms[atom];
  return (
    <>
      <b>{a.element}</b> #{atom + 1}
      {a.label !== a.element && ` (${a.label})`}
      {image && <span className="muted"> · image</span>}
      <br />
      frac {frac.map((x) => fmt(x)).join('  ')}
      <br />
      Å {cart.map((x) => fmt(x, 3)).join('  ')}
    </>
  );
}
