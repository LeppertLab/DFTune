import type { TagReader } from './reader';

export interface IntentChoice {
  id: string;
  label: string;
  description: string;
  /** Always written when the choice is applied. */
  force: Record<string, string>;
  /** Written only if the tag is not set yet; an existing value is kept. */
  suggest?: Record<string, string>;
  /** Whether the current INCAR corresponds to this choice. */
  matches(r: TagReader): boolean;
  /** Extra tags worth tuning for this choice, shown as fields alongside the suggested ones. */
  related?: string[];
  /** Advice shown when the choice is active (things the INCAR alone cannot express). */
  hints?: string[];
}

export interface IntentKind {
  id: string;
  label: string;
  /** Tags this intent controls: removed when the new choice neither forces nor suggests them. */
  owns: string[];
  /** Tags always shown as fields under the choice for fine-tuning. */
  related: string[];
  choices: IntentChoice[];
}
