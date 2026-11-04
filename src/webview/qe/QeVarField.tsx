import { useEffect, useState } from 'react';
import { checkItem, isQuoted, parseLogical, unquote, valueItems, type QeVar } from '../../core';

interface Props {
  v: QeVar;
  /** The label for accessibility: name or name(index). */
  label: string;
  /** Current raw value, undefined when the variable is not set. */
  value: string | undefined;
  /** Called with the new raw value as written in the file, or null to remove the variable. */
  onChange(value: string | null): void;
}

/** Typed editor for one namelist variable. Free text commits on Enter or blur. */
export function QeVarField({ v, label, value, onChange }: Props) {
  const placeholder = v.default || '';
  const distinct = [...new Map(v.options.map((o) => [o.value, o])).values()];

  if (v.type === 'logical') {
    const current = value === undefined ? '' : parseLogical(valueItems(value)[0] ?? '') ? '.true.' : '.false.';
    return (
      <select className={value === undefined ? 'unset' : ''} value={current} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
        <option value="">default{placeholder ? ` (${placeholder})` : ''}</option>
        <option value=".true.">.true.</option>
        <option value=".false.">.false.</option>
      </select>
    );
  }

  if (v.type === 'character' && distinct.length) {
    const shown = value === undefined ? '' : unquote(valueItems(value)[0] ?? '');
    const known = distinct.some((o) => o.value.toLowerCase() === shown.toLowerCase());
    return (
      <select className={value === undefined ? 'unset' : ''} value={known ? distinct.find((o) => o.value.toLowerCase() === shown.toLowerCase())!.value : shown} onChange={(e) => onChange(e.target.value ? `'${e.target.value}'` : null)} aria-label={label}>
        <option value="">default{placeholder ? ` (${placeholder})` : ''}</option>
        {distinct.map((o) => (
          <option key={o.value} value={o.value} title={o.note}>
            {o.value}
          </option>
        ))}
        {!known && shown !== '' && <option value={shown}>{shown}</option>}
      </select>
    );
  }
  return <TextField v={v} label={label} value={value} placeholder={placeholder} onChange={onChange} />;
}

function TextField({ v, label, value, placeholder, onChange }: Props & { placeholder: string }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const items = valueItems(draft);
  const problem = v.type && v.type !== 'character' && items.length ? items.map((i) => checkItem(v.type!, i)).find(Boolean) : undefined;

  const commit = () => {
    let next = draft.trim();
    if (next === (value ?? '')) return;
    if (next === '') return onChange(null);
    // Strings are written in quotes.
    if (v.type === 'character' && !isQuoted(next)) next = `'${next}'`;
    onChange(next);
  };
  return (
    <span className="text-field">
      <input
        className={problem ? 'invalid' : ''}
        value={draft}
        placeholder={placeholder}
        title={problem}
        aria-label={label}
        aria-invalid={!!problem}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value ?? '');
        }}
      />
    </span>
  );
}
