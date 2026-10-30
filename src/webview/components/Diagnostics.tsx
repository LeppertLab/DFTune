import type { Diagnostic } from '../../core';

const ICON: Record<Diagnostic['severity'], string> = { error: '✖', warning: '⚠', info: 'ℹ', hint: '💡' };

export function Diagnostics({ diagnostics, onReveal }: { diagnostics: Diagnostic[]; onReveal(offset: number, end?: number): void }) {
  if (diagnostics.length === 0) return <div className="diagnostics ok">✓ No problems found</div>;
  return (
    <ul className="diagnostics">
      {diagnostics.map((d, i) => (
        <li key={i} className={d.severity}>
          <button className="link" onClick={() => onReveal(d.span?.start ?? 0, d.span?.end)} title="Show in the text editor">
            <span className="icon">{ICON[d.severity]}</span> {d.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
