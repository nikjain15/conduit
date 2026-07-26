/**
 * Prompt registry types.
 *
 * A prompt is versioned: the same ref carries a list of versions and one active
 * version. Resolution reads the active version (or an explicit override), inlines
 * any named template snippets, and interpolates variables. The store never mutates
 * during resolution and resolution never throws: a missing variable or a missing
 * template include leaves the placeholder in place and records a warning.
 */

/** One immutable revision of a prompt's text. */
export interface PromptVersion {
  /** Version label, unique within a prompt, for example "v1". */
  version: string;
  /** The system prompt body. May contain {{variable}} and {{>template}} tokens. */
  text: string;
  /** A logical revision reference, not a wall clock time, for example "rev-1". */
  createdAtRef: string;
}

/** A versioned prompt addressed by ref. */
export interface PromptRecord {
  /** Registry key, for example "kb-search.system". */
  ref: string;
  /** All revisions, oldest first by convention. */
  versions: PromptVersion[];
  /** The version label served by default. Must match one of versions[].version. */
  active: string;
  /** Named snippets composed into the text via {{>name}}. Optional. */
  templates?: Record<string, string>;
}

/** A collection of prompts, keyed by ref. */
export interface PromptStore {
  prompts: Record<string, PromptRecord>;
}

/** Options that steer one resolution. */
export interface ResolveOptions {
  /** Resolve this version instead of the record's active version. */
  version?: string;
  /**
   * Extra templates from the caller (for example a use case profile's
   * prompt.templates). Merged over the record's own templates, so a profile can
   * override a snippet without editing the stored prompt.
   */
  templates?: Record<string, string>;
}

/** The result of resolving a prompt. `text` is always a string. */
export interface ResolveResult {
  ref: string;
  /** The version actually resolved. */
  version: string;
  /** The composed, interpolated system text. */
  text: string;
  /** Non fatal problems: unknown variables and unknown template includes. */
  warnings: string[];
}
