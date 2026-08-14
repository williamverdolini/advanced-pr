/**
 * The envelope every comment this extension writes carries, the plan and the
 * review events alike: an HTML comment holding a JSON payload, which Azure
 * DevOps renders as nothing. The `kind` inside says which of the two it is, and
 * `parsePlanMarker` and `parseLedgerEvent` each read their own.
 */
export const markerPattern = /<!--\s*advanced-pr:v2\s+(\{.*?\})\s*-->/s;

/**
 * Whether a comment was written by the extension rather than typed by a person.
 * The sign-off warning counts the discussions a reviewer has left open, and a
 * plan or a recorded decision is neither: counted, they would inflate the
 * warning on every review, and a plan revised twice inflates it three times.
 */
export function isGeneratedComment(content: string): boolean {
  return markerPattern.test(content);
}
