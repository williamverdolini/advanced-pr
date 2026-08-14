export interface MentionQuery {
  /** Index of the `@` that opened the query. */
  start: number;
  /** Text typed after the `@`, used as the search term. */
  query: string;
}

/** Beyond this the text stopped being a name and the typeahead gives up. */
const maxQueryLength = 40;

/**
 * Finds the mention being typed at the caret, if any. The `@` only opens a
 * query at the start of a word, so an email address never does.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | undefined {
  const upToCaret = text.slice(0, caret);
  const start = upToCaret.lastIndexOf("@");
  if (start < 0) {
    return undefined;
  }

  const before = start > 0 ? upToCaret[start - 1] : undefined;
  if (before !== undefined && !/[\s([{]/.test(before)) {
    return undefined;
  }

  const query = upToCaret.slice(start + 1);
  if (query.length > maxQueryLength || /[\n\r]/.test(query) || /^\s/.test(query)) {
    return undefined;
  }

  // An already completed mention is not a query being typed.
  if (query.startsWith("<")) {
    return undefined;
  }

  return { start, query };
}

export interface MentionInsertion {
  text: string;
  caret: number;
}

/**
 * Replaces the typed query with the readable form, `@Display Name`, and leaves
 * the caret after the trailing space so typing can continue. The editor turns
 * it into the token Azure DevOps stores on its way out.
 */
export function insertMention(
  text: string,
  mention: MentionQuery,
  displayName: string,
): MentionInsertion {
  const inserted = `@${displayName} `;
  const end = mention.start + 1 + mention.query.length;
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(end)}`,
    caret: mention.start + inserted.length,
  };
}
