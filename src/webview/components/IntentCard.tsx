import { describeChoice, detectIntent, fieldTags, intentChanges, tagDef, wikiUrl, type IncarDoc, type IntentKind, type TagChanges, type TagReader } from '../../core';
import { TagField } from './TagField';

interface Props {
  kind: IntentKind;
  doc: IncarDoc;
  reader: TagReader;
  onApply(changes: TagChanges): void;
}

export function IntentCard({ kind, doc, reader, onApply }: Props) {
  const current = detectIntent(kind, reader);
  const choice = kind.choices.find((c) => c.id === current);
  const owned = kind.owns.filter((t) => doc.tags.has(t));
  const fields = fieldTags(kind, current, reader);

  return (
    <div className="card">
      <div className="card-head">
        <label htmlFor={`intent-${kind.id}`}>{kind.label}</label>
        <select
          id={`intent-${kind.id}`}
          value={current}
          onChange={(e) => e.target.value !== 'custom' && onApply(intentChanges(kind, e.target.value, reader))}
        >
          {current === 'custom' && <option value="custom">Custom</option>}
          {kind.choices.map((c) => (
            <option key={c.id} value={c.id} title={describeChoice(kind, c.id)}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {choice ? (
        <p className="muted">{choice.description}</p>
      ) : (
        <p className="muted">
          The current tags don't match a preset{owned.length ? ` (${owned.map((t) => `${t} = ${doc.tags.get(t)!.value}`).join(', ')})` : ''}. Picking one rewrites them.
        </p>
      )}
      {choice && (
        <p className="writes" title="Tags this choice writes. * = suggested value, only written when the tag is not set yet.">
          <code>{describeChoice(kind, choice.id)}</code>
        </p>
      )}
      {choice?.hints?.map((h) => (
        <p key={h} className="hint">{h}</p>
      ))}

      {fields.length > 0 && (
        <div className="related">
          {fields.map((name) => {
            const def = tagDef(name);
            return (
              <div key={name} className="field-row">
                <a href={wikiUrl(name)} title={def?.summary}>{name}</a>
                <TagField def={def} name={name} value={doc.tags.get(name)?.value} onChange={(v) => onApply({ [name]: v })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
