import { useEffect, useState } from 'react';
import { checkValue, sameValue, type TagDef } from '../../core';

interface Props {
  def?: TagDef;
  name: string;
  /** Current raw value, undefined when the tag is not set. */
  value: string | undefined;
  /** Called with the new raw value, or null to remove the tag. */
  onChange(value: string | null): void;
}

/** Typed editor for one tag. Free-text inputs commit on Enter or blur, not on every keystroke. */
export function TagField({ def, name, value, onChange }: Props) {
  const placeholder = def?.default ?? def?.defaultNote ?? '';

  if (def?.type === 'bool') {
    return (
      <select className={value === undefined ? 'unset' : ''} value={value === undefined ? '' : sameValue(def, value, '.TRUE.') ? '.TRUE.' : '.FALSE.'} onChange={(e) => onChange(e.target.value || null)} aria-label={name}>
        <option value="">default ({def.default})</option>
        <option value=".TRUE.">.TRUE.</option>
        <option value=".FALSE.">.FALSE.</option>
      </select>
    );
  }

  if (def?.options && !def.open) {
    const match = value === undefined ? '' : def.options.find((o) => sameValue(def, o.value, value))?.value ?? value;
    const known = def.options.some((o) => o.value === match);
    return (
      <select className={value === undefined ? 'unset' : ''} value={match} onChange={(e) => onChange(e.target.value || null)} aria-label={name}>
        <option value="">default{placeholder ? ` (${placeholder})` : ''}</option>
        {def.options.map((o) => (
          <option key={o.value} value={o.value} title={o.description}>
            {o.value}: {o.label}
          </option>
        ))}
        {!known && match !== '' && <option value={match}>{match}</option>}
      </select>
    );
  }

  return <TextField def={def} name={name} value={value} placeholder={placeholder} onChange={onChange} />;
}

function TextField({ def, name, value, placeholder, onChange }: Props & { placeholder: string }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const error = def && draft.trim() !== '' ? checkValue(def, draft.trim()) : undefined;
  const listId = def?.options ? `opts-${name}` : undefined;

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? '')) return;
    onChange(next === '' ? null : next);
  };

  return (
    <span className="text-field">
      <input
        className={error ? 'invalid' : ''}
        value={draft}
        placeholder={placeholder}
        list={listId}
        title={error}
        aria-label={name}
        aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value ?? '');
        }}
      />
      {def?.unit && <span className="unit">{def.unit}</span>}
      {listId && (
        <datalist id={listId}>
          {def!.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </datalist>
      )}
    </span>
  );
}
