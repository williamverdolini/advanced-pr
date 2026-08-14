/**
 * A published date as the reader's locale writes it. An unparseable value comes
 * back empty rather than as `Invalid Date`: a missing timestamp is not worth
 * disturbing the line it sits on.
 */
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
