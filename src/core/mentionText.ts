const guidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export interface DisplayText {
  text: string;
  /** Lower-cased display name to identity id, for the way back. */
  names: ReadonlyMap<string, string>;
}

/**
 * Turns the stored form of a comment into what the editor shows: `@<GUID>`
 * becomes `@Display Name`. An id that cannot be resolved keeps its token, so
 * editing a comment never silently drops a mention it could not read.
 */
export function toDisplayText(
  stored: string,
  resolve: (id: string) => { displayName: string } | undefined,
): DisplayText {
  const names = new Map<string, string>();
  const text = stored.replace(new RegExp(`@<(${guidPattern})>`, "g"), (token, id: string) => {
    const identity = resolve(id.toLowerCase());
    if (!identity) {
      return token;
    }

    names.set(identity.displayName.toLowerCase(), id.toLowerCase());
    return `@${identity.displayName}`;
  });

  return { text, names };
}

/**
 * Turns what the editor shows back into what Azure DevOps stores. Only names
 * the directory knows become tokens; anything else stays literal text, so
 * typing an `@` in prose never fabricates a mention.
 */
export function toStoredText(
  display: string,
  directory: ReadonlyMap<string, string>,
): string {
  if (directory.size === 0) {
    return display;
  }

  // Longest first, so "@Anna Bianchi" is not cut short by a known "@Anna".
  const names = [...directory.keys()].sort((left, right) => right.length - left.length);
  const pattern = new RegExp(
    `(^|[\\s([{])@(${names.map(escapeForRegExp).join("|")})(?![\\w.@-])`,
    "gi",
  );

  return display.replace(pattern, (match, prefix: string, name: string) => {
    const id = directory.get(name.toLowerCase());
    return id ? `${prefix}@<${id.toUpperCase()}>` : match;
  });
}

/**
 * Names claimed by more than one identity cannot be turned back into a token
 * without guessing, so they are dropped from the directory and stay as text.
 */
export function mergeMentionDirectory(
  ...sources: readonly ReadonlyMap<string, string>[]
): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const source of sources) {
    for (const [name, id] of source) {
      const existing = merged.get(name);
      if (existing && existing !== id) {
        ambiguous.add(name);
      } else {
        merged.set(name, id);
      }
    }
  }

  for (const name of ambiguous) {
    merged.delete(name);
  }

  return merged;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
