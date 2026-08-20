/**
 * Pull request attachments, which is where an image pasted into a comment ends
 * up: Azure DevOps stores them per pull request, addressed by file name, and the
 * comment itself only carries a Markdown image link to one.
 */
import { safeImageHref } from "./markdown";

const imageMediaTypes: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
]);

const extensionsByMediaType: ReadonlyMap<string, string> = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/svg+xml", ".svg"],
]);

/**
 * The attachment name a file can be stored under. Spaces and brackets would
 * have to be percent-encoded in the link, and a `)` ends the href for this
 * parser as well as for Azure DevOps' own, so a pasted file is renamed rather
 * than left with a href nothing can read back.
 */
export function normalizeAttachmentName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = leaf.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");

  return safe || "image.png";
}

/**
 * A name no attachment on the pull request holds yet. Uploading under a taken
 * name replaces the file behind it, which may be somebody else's image: every
 * screenshot arrives called `image.png`.
 */
export function uniqueAttachmentName(fileName: string, takenNames: Iterable<string>): string {
  const name = normalizeAttachmentName(fileName);
  const taken = new Set([...takenNames].map((value) => value.toLowerCase()));
  if (!taken.has(name.toLowerCase())) {
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export interface AttachmentReference {
  pullRequestId: number;
  fileName: string;
}

const attachmentUrlPattern =
  /\/_apis\/git\/repositories\/[^/]+\/pullrequests\/(\d+)\/attachments\/([^/?#]+)$/i;

/**
 * The pull request and file an attachment href points at, when it points at one
 * at all. An ordinary image URL in a comment returns undefined and is left to
 * the browser; an attachment has to be read through the REST client, which
 * needs the name back out of the href.
 */
export function parseAttachmentReference(href: string): AttachmentReference | undefined {
  const match = attachmentUrlPattern.exec(href.trim());
  if (!match) {
    return undefined;
  }

  return { pullRequestId: Number(match[1]), fileName: decodeAttachmentName(match[2]) };
}

function decodeAttachmentName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    // A stray `%` is not an encoding, and the server accepted the name as it is.
    return name;
  }
}

/** The link an uploaded image is written into the comment as. */
export function attachmentImageMarkdown(name: string, url: string): string {
  return `![${name}](${url})`;
}

export type CommentImageSource =
  | { kind: "attachment"; fileName: string }
  | { kind: "url"; href: string };

/**
 * Where the image an inline node points at has to be read from. Attachments go
 * through the REST client — they are only readable with the extension's token —
 * and anything else is a URL the browser fetches by itself. Undefined when
 * neither is possible, in which case the alternative text stands in for the
 * picture.
 *
 * The href is not one shape: the editor writes the absolute URL the upload
 * answered with, Azure DevOps writes a path relative to the organization, and
 * its own editor leaves behind the object URL it previewed the upload with.
 */
export function commentImageSource(
  href: string,
  alt: string,
  pullRequestId: number,
): CommentImageSource | undefined {
  const reference = parseAttachmentReference(href);
  if (reference) {
    // Another pull request's attachment is as unreadable here as it is in the
    // Azure DevOps UI, which is where a comment carrying one was copied from.
    return reference.pullRequestId === pullRequestId
      ? { kind: "attachment", fileName: reference.fileName }
      : undefined;
  }

  const loadable = safeImageHref(href);
  if (loadable) {
    return { kind: "url", href: loadable };
  }

  // An object URL is local to the session that wrote it, so it is dead for
  // every other reader. The file name it was uploaded under is the attachment's
  // identity within the pull request, and the alternative text carries it.
  return /^blob:/i.test(href.trim()) && alt.trim()
    ? { kind: "attachment", fileName: normalizeAttachmentName(alt) }
    : undefined;
}

/**
 * The media type of an attachment, taken from its name: the endpoint that reads
 * the bytes back answers with `application/octet-stream` whatever they are, so
 * the type an `<img>` needs has to be reconstructed here.
 */
export function imageMediaType(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");

  return dot < 0 ? undefined : imageMediaTypes.get(fileName.slice(dot).toLowerCase());
}

/** Names the file a paste carries no name for, which is most screenshots. */
export function extensionForMediaType(mediaType: string): string {
  return extensionsByMediaType.get(mediaType.trim().toLowerCase()) ?? ".png";
}
