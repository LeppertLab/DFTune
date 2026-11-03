import { fallbackDef, groupTags, knownTag, tagDef, wikiUrl, type IncarDoc, type TagChanges } from '../../core';
import { TagField } from './TagField';

interface Props {
  /** Group prefix, e.g. KERNEL_TRUNCATION. */
  group: string;
  doc: IncarDoc;
  onApply(changes: TagChanges): void;
  onReveal(offset: number, end?: number): void;
}

/**
 * A card for a group of nested tags (`GROUP/TAG` or a `GROUP { … }` block): the documented tags of
 * the group plus any others set in the file, listed by their short names.
 */
export function GroupCard({ group, doc, onApply, onReveal }: Props) {
  const prefix = `${group}/`;
  const set = [...doc.tags.keys()].filter((k) => k.startsWith(prefix));
  const names = [...new Set([...groupTags(group), ...set])];
  const block = doc.blocks.find((b) => b.name === group);

  return (
    <div className="card">
      <div className="card-head">
        <span className="label">{group}</span>
        {block && (
          <button className="icon-button" onClick={() => onReveal(block.span.start, block.span.end)} title="Show the block in the text editor">↗</button>
        )}
      </div>
      <p className="muted">Nested tags, written as <code>{group} {'{ … }'}</code> or <code>{group}/TAG</code>.</p>
      <div className="related">
        {names.map((name) => {
          const def = tagDef(name) ?? fallbackDef(name);
          const page = knownTag(name)?.page;
          const short = name.slice(prefix.length);
          return (
            <div key={name} className="field-row">
              {page ? <a href={wikiUrl(page)} title={def?.summary}>{short}</a> : <span title={def?.summary}>{short}</span>}
              <TagField def={def} name={name} value={doc.tags.get(name)?.value} onChange={(v) => onApply({ [name]: v })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
