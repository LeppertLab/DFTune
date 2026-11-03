import type { Diagnostic, TextEdit } from '../../core';

const ICON: Record<Diagnostic['severity'], string> = { error: '✖', warning: '⚠', info: 'ℹ', hint: '💡' };

interface Props {
  diagnostics: Diagnostic[];
  onReveal(offset: number, end?: number): void;
  /** Applies a diagnostic's quick fix. */
  onFix(edit: TextEdit): void;
}

export function Diagnostics({ diagnostics, onReveal, onFix }: Props) {
  if (diagnostics.length === 0) return <div className="diagnostics ok">✓ No problems found</div>;
  return (
    <ul className="diagnostics">
      {diagnostics.map((d, i) => (
        <li key={i} className={d.severity}>
          <button className="link" onClick={() => onReveal(d.span?.start ?? 0, d.span?.end)} title="Show in the text editor">
            <span className="icon">{ICON[d.severity]}</span> {d.message}
          </button>
          {d.fix && (
            <button className="secondary fix" onClick={() => onFix(d.fix!.edit)} title="Apply this change to the INCAR">
              {d.fix.title}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
