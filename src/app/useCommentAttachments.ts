import * as React from "react";
import type { AttachmentService, UploadedAttachment } from "../components/attachmentContext";
import { commentImageSource, extensionForMediaType } from "../core/attachments";
import {
  loadCommentAttachment,
  uploadCommentAttachment,
  type AttachmentSource,
} from "../platform/azureDevOpsClient";

/**
 * Images in comments: uploading one that was pasted, and reading one back for
 * display. The bytes go through the REST client rather than the browser's own
 * image loader, because an attachment is only readable with the extension's
 * token — see `AttachmentService`.
 */
export function useCommentAttachments(source: AttachmentSource): AttachmentService {
  // Object URLs by attachment name, lower-cased. Promises, not strings: the same
  // image appears in the preview and in the thread beside it, and the second one
  // has to wait for the first fetch instead of starting another.
  const imagesRef = React.useRef(new Map<string, Promise<string>>());

  React.useEffect(() => {
    const images = imagesRef.current;

    return () => {
      for (const pending of images.values()) {
        void pending.then(
          (objectUrl) => {
            if (objectUrl.startsWith("blob:")) {
              URL.revokeObjectURL(objectUrl);
            }
          },
          () => undefined,
        );
      }
      images.clear();
    };
  }, []);

  const resolveImage = React.useCallback(
    (href: string, alt: string): Promise<string | undefined> => {
      const wanted = commentImageSource(href, alt, source.id);
      if (!wanted) {
        return Promise.resolve(undefined);
      }
      // An ordinary image URL: the browser loads it by itself, as it does in the
      // Azure DevOps UI.
      if (wanted.kind === "url") {
        return Promise.resolve(wanted.href);
      }

      // Keyed by the attachment rather than by the href, because the same file
      // is written into comments under more than one href: the absolute URL the
      // upload answered with, the path relative to the organization, and the
      // object URL Azure DevOps' own editor leaves behind.
      const key = wanted.fileName.toLowerCase();
      const cached = imagesRef.current.get(key);
      if (cached) {
        return cached;
      }

      const pending = loadCommentAttachment(source, wanted.fileName)
        .then((content) => URL.createObjectURL(content))
        .catch((error: unknown) => {
          // Not cached as a failure: a retry on the next render is cheap, and a
          // transient error would otherwise keep the image broken for good.
          imagesRef.current.delete(key);
          throw error;
        });
      imagesRef.current.set(key, pending);

      return pending;
    },
    [source],
  );

  const upload = React.useCallback(
    async (file: File): Promise<UploadedAttachment> => {
      const name = file.name || `image${extensionForMediaType(file.type)}`;
      const attachment = await uploadCommentAttachment(source, name, await file.arrayBuffer());
      // The bytes are already here, so the preview shows the image without
      // reading it back: this is the object URL `resolveImage` would fetch.
      imagesRef.current.set(
        attachment.name.toLowerCase(),
        Promise.resolve(URL.createObjectURL(file)),
      );

      return attachment;
    },
    [source],
  );

  return React.useMemo(() => ({ resolveImage, upload }), [resolveImage, upload]);
}
