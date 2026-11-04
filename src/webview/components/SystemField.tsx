import { tagDef, wikiUrl } from '../../core';
import { TagField } from './TagField';

interface Props {
  /** Current SYSTEM value (quotes removed), undefined when not set. */
  value: string | undefined;
  /** New raw value, or null to remove SYSTEM. */
  onChange(value: string | null): void;
}

/** The title of the calculation, editable right under the file header. */
export function SystemField({ value, onChange }: Props) {
  return (
    <label className="system-field">
      <a href={wikiUrl('SYSTEM')} title={tagDef('SYSTEM')?.summary}>SYSTEM</a>
      <TagField
        def={tagDef('SYSTEM')}
        name="SYSTEM"
        value={value}
        placeholder="Title of this calculation"
        onChange={(v) => onChange(v === null ? null : systemValue(v))}
      />
    </label>
  );
}

/**
 * The raw INCAR value for a title: quoted when it contains characters that would otherwise end
 * the statement (`;`) or start a comment (`!`, `#`), so VASP reads the whole title.
 */
export function systemValue(title: string): string {
  return /[;!#]/.test(title) && !title.includes('"') ? `"${title}"` : title;
}
