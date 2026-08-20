import * as React from "react";

export interface UploadedAttachment {
  name: string;
  url: string;
}

/**
 * Storing an image pasted into a comment, and reading one back to show it.
 * Ambient like the mention resolver, and for the same reason: every editor and
 * every rendered comment in the review needs it, and none of them is allowed to
 * know about the REST client.
 */
export interface AttachmentService {
  /** Uploads a pasted file and answers with the link to write into the comment. */
  upload: (file: File) => Promise<UploadedAttachment>;
  /**
   * The `src` an `<img>` can load for an image in a comment, or undefined when
   * there is nothing loadable behind it. A pull request attachment is only
   * readable with the extension's token — the comment is rendered in an iframe
   * on another origin, where the browser sends no Azure DevOps cookie — so its
   * bytes are fetched through the client and handed over as an object URL. Any
   * other image URL is returned unchanged, for the browser to load itself.
   *
   * The alternative text is needed as well as the href, because it carries the
   * file name when the href does not: see `commentImageSource`.
   */
  resolveImage: (href: string, alt: string) => Promise<string | undefined>;
}

export const AttachmentContext = React.createContext<AttachmentService | undefined>(undefined);
