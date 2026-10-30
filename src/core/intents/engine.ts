import type { TagChanges } from '../incar/edit';
import type { TagReader } from './reader';
import type { IntentKind } from './types';

/** Id of the first matching choice, or 'custom' when the tags fit none of them. */
export function detectIntent(kind: IntentKind, r: TagReader): string {
  return kind.choices.find((c) => c.matches(r))?.id ?? 'custom';
}

/**
 * Tag changes that switch `kind` to `choiceId`:
 * forced tags are written, suggested tags are added only when absent (an empty suggested
 * value means "keep if present, never add"), and other owned tags are removed.
 */
export function intentChanges(kind: IntentKind, choiceId: string, r: TagReader): TagChanges {
  const choice = kind.choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Unknown choice '${choiceId}' for intent '${kind.id}'`);
  const suggest = choice.suggest ?? {};
  const keep = new Set([...Object.keys(choice.force), ...Object.keys(suggest)]);
  const changes: TagChanges = {};
  for (const tag of kind.owns) {
    if (!keep.has(tag) && r.has(tag)) changes[tag] = null;
  }
  for (const [tag, value] of Object.entries(suggest)) {
    if (value !== '' && !r.has(tag)) changes[tag] = value;
  }
  Object.assign(changes, choice.force);
  return changes;
}

/**
 * Tags to offer as fields for the current state of `kind`: the kind's own related tags, the
 * choice's suggested and related tags, and for a custom setup every owned tag that is set.
 */
export function fieldTags(kind: IntentKind, choiceId: string, r: TagReader): string[] {
  const choice = kind.choices.find((c) => c.id === choiceId);
  const tags = choice
    ? [...kind.related, ...Object.keys(choice.suggest ?? {}), ...(choice.related ?? [])]
    : [...kind.related, ...kind.owns.filter((t) => r.has(t))];
  return [...new Set(tags)];
}

/** Tags a choice writes, for display ("GGA = PE, LHFCALC = .TRUE."). */
export function describeChoice(kind: IntentKind, choiceId: string): string {
  const choice = kind.choices.find((c) => c.id === choiceId);
  if (!choice) return '';
  const parts = Object.entries(choice.force).map(([k, v]) => `${k} = ${v}`);
  for (const [k, v] of Object.entries(choice.suggest ?? {})) if (v !== '') parts.push(`${k} = ${v}*`);
  return parts.join(', ') || '(removes the related tags)';
}
