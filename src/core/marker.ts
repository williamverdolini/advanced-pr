/**
 * The envelope every comment this extension writes carries, the plan and the
 * review events alike: a JSON payload that Azure DevOps renders as nothing. The
 * `kind` inside says which of the two it is, and `parsePlanMarker` and
 * `parseLedgerEvent` each read their own.
 *
 * `v3` writes it as a Markdown link reference definition. `v2` wrote it as an
 * HTML comment, which the web interface hides but the notification mail does
 * not: a step approval arrived in everyone's inbox with a line of identifiers
 * under it. A link definition is dropped by anything that renders Markdown,
 * that mail included.
 *
 * Both are read. The ledger is append-only, so every decision already recorded
 * is a `v2` comment that has to keep counting, and there is nothing to migrate:
 * the next event is simply written in the newer envelope.
 */
const v3Pattern = String.raw`\[\/\/\]:\s*#\s*\(advanced-pr:v3\s+(\{.*?\})\s*\)`;
const v2Pattern = String.raw`<!--\s*advanced-pr:v2\s+(\{.*?\})\s*-->`;

export const markerPattern = new RegExp(`(?:${v3Pattern}|${v2Pattern})`, "s");

export function formatMarker(payload: unknown): string {
  // A bare `)` would end the link definition early, truncating the payload into
  // something that no longer parses — a decision silently lost. Nothing put in
  // one today can contain a parenthesis, every field being an id, an integer or
  // a hash, but the cost of being wrong about that later is a comment that
  // cannot be read back at all.
  const payloadText = JSON.stringify(payload).replace(/[()]/g, "\\$&");
  return `[//]: # (advanced-pr:v3 ${payloadText})`;
}

/** The JSON text inside the envelope, whichever version wrote it. */
export function readMarkerPayload(content: string): string | undefined {
  const match = content.match(markerPattern);
  if (!match) {
    return undefined;
  }

  const payloadText = match[1] ?? match[2];
  return payloadText.replace(/\\([()])/g, "$1");
}

/**
 * Whether a comment was written by the extension rather than typed by a person.
 * The sign-off warning counts the discussions a reviewer has left open, and a
 * plan or a recorded decision is neither: counted, they would inflate the
 * warning on every review, and a plan revised twice inflates it three times.
 */
export function isGeneratedComment(content: string): boolean {
  return markerPattern.test(content);
}
