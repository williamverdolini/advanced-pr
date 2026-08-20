import { describe, expect, it } from "vitest";
import {
  attachmentImageMarkdown,
  commentImageSource,
  extensionForMediaType,
  imageMediaType,
  normalizeAttachmentName,
  parseAttachmentReference,
  uniqueAttachmentName,
} from "../src/core/attachments";

describe("comment attachments", () => {
  it("keeps a name that is already safe in a Markdown href", () => {
    expect(normalizeAttachmentName("image.png")).toBe("image.png");
    expect(normalizeAttachmentName("Diagram-2.svg")).toBe("Diagram-2.svg");
  });

  it("renames a file whose name would break the link", () => {
    // Spaces and brackets would need encoding, and a `)` would end the href.
    expect(normalizeAttachmentName("Screen shot (2).png")).toBe("Screen-shot-2-.png");
    expect(normalizeAttachmentName("C:\\Users\\me\\pictures\\shot.png")).toBe("shot.png");
    expect(normalizeAttachmentName("   ")).toBe("image.png");
  });

  it("finds a name no attachment holds yet", () => {
    expect(uniqueAttachmentName("image.png", [])).toBe("image.png");
    expect(uniqueAttachmentName("image.png", ["image.png"])).toBe("image-2.png");
    expect(uniqueAttachmentName("image.png", ["image.png", "image-2.png"])).toBe("image-3.png");
  });

  it("compares taken names without case, the way the service does", () => {
    expect(uniqueAttachmentName("Image.png", ["image.png"])).toBe("Image-2.png");
  });

  it("reads the pull request and the file out of an attachment href", () => {
    expect(
      parseAttachmentReference(
        "https://dev.azure.com/org/project/_apis/git/repositories/repo-id/pullRequests/2/attachments/image.png",
      ),
    ).toEqual({ pullRequestId: 2, fileName: "image.png" });
  });

  it("decodes the file name, which the service returns encoded", () => {
    expect(
      parseAttachmentReference(
        "https://dev.azure.com/org/_apis/git/repositories/repo/pullRequests/7/attachments/my%20shot.png",
      )?.fileName,
    ).toBe("my shot.png");
  });

  it("leaves any other image URL to the browser", () => {
    expect(parseAttachmentReference("https://example.com/image.png")).toBeUndefined();
    // What Azure DevOps' own editor writes while the upload is in flight: a
    // local object URL, dead by the time anybody else reads the comment.
    expect(parseAttachmentReference("blob:https://dev.azure.com/0eaee1d9-a085")).toBeUndefined();
  });

  it("writes the link the comment carries", () => {
    expect(attachmentImageMarkdown("image.png", "https://dev.azure.com/x")).toBe(
      "![image.png](https://dev.azure.com/x)",
    );
  });

  describe("where a comment's image is read from", () => {
    const absolute =
      "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/2/attachments/image.png";
    // What the pull request comment carries when the link was not written by
    // this extension: a path relative to the organization.
    const relative =
      "/org/project/_apis/git/repositories/repo/pullRequests/2/attachments/image-2.png";

    it("reads an attachment of this pull request through the client", () => {
      expect(commentImageSource(absolute, "image.png", 2)).toEqual({
        kind: "attachment",
        fileName: "image.png",
      });
      expect(commentImageSource(relative, "image-2.png", 2)).toEqual({
        kind: "attachment",
        fileName: "image-2.png",
      });
    });

    it("falls back to the file name when the href is a dead object URL", () => {
      // Azure DevOps' own editor previews the upload with an object URL, which
      // is local to the session that wrote it.
      expect(commentImageSource("blob:https://dev.azure.com/0eaee1d9", "image.png", 2)).toEqual({
        kind: "attachment",
        fileName: "image.png",
      });
      expect(commentImageSource("blob:https://dev.azure.com/0eaee1d9", "", 2)).toBeUndefined();
    });

    it("leaves an ordinary image URL to the browser", () => {
      expect(commentImageSource("https://example.com/shot.png", "shot", 2)).toEqual({
        kind: "url",
        href: "https://example.com/shot.png",
      });
    });

    it("shows the alternative text when nothing can be loaded", () => {
      // An upload still in flight, another pull request's attachment, and a
      // href that is not a URL at all.
      expect(commentImageSource("upload:1", "Uploading image.png…", 2)).toBeUndefined();
      expect(commentImageSource(absolute, "image.png", 7)).toBeUndefined();
      expect(commentImageSource("image.png", "image.png", 2)).toBeUndefined();
    });
  });

  it("takes the media type from the name, since the download has none", () => {
    expect(imageMediaType("shot.PNG")).toBe("image/png");
    expect(imageMediaType("shot.jpeg")).toBe("image/jpeg");
    expect(imageMediaType("notes.txt")).toBeUndefined();
    expect(imageMediaType("nodots")).toBeUndefined();
  });

  it("names a pasted file the clipboard gave no name for", () => {
    expect(extensionForMediaType("image/jpeg")).toBe(".jpg");
    expect(extensionForMediaType("image/gif")).toBe(".gif");
    expect(extensionForMediaType("image/unknown")).toBe(".png");
  });
});
