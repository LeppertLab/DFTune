import { SECTION_LABELS, plainTags, tagDef, wikiUrl, type IncarDoc, type SectionId, type TagChanges, type TagReader } from '../../core';
import { TagField } from './TagField';

interface Props {
  section: SectionId;
  doc: IncarDoc;
  reader: TagReader;
  onApply(changes: TagChanges): void;
}

/** A section no preset covers (parallelization, flow control): its everyday tags as fields. */
export function SectionCard({ section, doc, reader, onApply }: Props) {
  return (
    <div className="card">
      <div className="related">
        {plainTags(section, reader).map((name) => {
          const def = tagDef(name);
          return (
            <div key={name} className="field-row">
              <a href={wikiUrl(name)} title={def?.summary}>{name}</a>
              <TagField def={def} name={name} value={doc.tags.get(name)?.value} onChange={(v) => onApply({ [name]: v })} />
            </div>
          );
        })}
      </div>
      <span hidden>{SECTION_LABELS[section]}</span>
    </div>
  );
}
