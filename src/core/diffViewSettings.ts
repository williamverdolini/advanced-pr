/**
 * How the diff is rendered, as the reader likes it. Not review state and not a
 * property of a pull request: the same three answers hold for every pull
 * request this reader opens, until they change them.
 */
export interface DiffViewSettings {
  readonly showWhitespace: boolean;
  readonly wordWrap: boolean;
  readonly stickyScroll: boolean;
}

export const defaultDiffViewSettings: DiffViewSettings = {
  showWhitespace: false,
  wordWrap: false,
  // Monaco's own default, and what the extension shipped with.
  stickyScroll: true,
};

/**
 * A stored value outlives the shape it was written under: a settings object
 * from an older build is missing the keys added since, and anything on the
 * origin could have written the key. Each setting is therefore read on its own
 * and falls back to its default, rather than one bad field discarding the rest.
 */
export function readDiffViewSettings(stored: string | null | undefined): DiffViewSettings {
  if (!stored) {
    return defaultDiffViewSettings;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return defaultDiffViewSettings;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return defaultDiffViewSettings;
  }

  const record = parsed as Record<string, unknown>;
  return {
    showWhitespace: readFlag(record.showWhitespace, defaultDiffViewSettings.showWhitespace),
    wordWrap: readFlag(record.wordWrap, defaultDiffViewSettings.wordWrap),
    stickyScroll: readFlag(record.stickyScroll, defaultDiffViewSettings.stickyScroll),
  };
}

export function writeDiffViewSettings(settings: DiffViewSettings): string {
  return JSON.stringify(settings);
}

function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
