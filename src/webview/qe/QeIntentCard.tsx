import { describeQeChoice, detectQeIntent, lookupVar, qeIntentChanges, type QeChange, type QeDoc, type QeIntent, type QeProgram, type Reader } from '../../core';
import { QeVarField } from './QeVarField';

interface Props {
  kind: QeIntent;
  doc: QeDoc;
  reader: Reader;
  program: QeProgram;
  onApply(changes: QeChange[]): void;
}

export function QeIntentCard({ kind, doc, reader, program, onApply }: Props) {
  const current = kind.choices.length ? detectQeIntent(kind, reader) : undefined;
  const choice = kind.choices.find((c) => c.id === current);
  const owned = kind.owns.filter((o) => reader.has(o.namelist, o.name, o.index));

  return (
    <div className="card">
      <div className="card-head">
        <label htmlFor={`intent-${kind.id}`}>{kind.label}</label>
        {kind.choices.length > 0 && (
          <select id={`intent-${kind.id}`} value={current} onChange={(e) => e.target.value !== 'custom' && onApply(qeIntentChanges(kind, e.target.value, reader))}>
            {current === 'custom' && <option value="custom">Custom</option>}
            {kind.choices.map((c) => (
              <option key={c.id} value={c.id} title={describeQeChoice(c)}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {kind.choices.length > 0 &&
        (choice ? (
          <p className="muted">{choice.description}</p>
        ) : (
          <p className="muted">
            The current variables don't match a preset{owned.length ? ` (${owned.map((o) => `${o.name}${o.index ? `(${o.index})` : ''} = ${reader.entry(o.namelist, o.name, o.index)?.value}`).join(', ')})` : ''}. Picking one rewrites them.
          </p>
        ))}
      {choice && (
        <p className="writes" title="Variables this choice writes. * = suggested value, only written when the variable is not set yet.">
          <code>{describeQeChoice(choice)}</code>
        </p>
      )}
      {choice?.hints?.map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
      {kind.related.length > 0 && (
        <div className="related">
          {kind.related.map((ref) => {
            const v = lookupVar(program, ref.namelist, ref.name);
            if (!v) return null;
            const label = `${v.name}${ref.index ? `(${ref.index})` : ''}`;
            const entry = reader.entry(ref.namelist, ref.name, ref.index);
            return (
              <div key={label} className="field-row">
                <span title={v.summary}>{label}</span>
                <QeVarField v={v} label={label} value={entry?.value} onChange={(value) => onApply([{ namelist: ref.namelist, name: v.name, index: ref.index, value }])} />
              </div>
            );
          })}
        </div>
      )}
      <span hidden>{doc.namelists.length}</span>
    </div>
  );
}
