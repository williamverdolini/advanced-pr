import { describe, expect, it } from "vitest";
import { buildThreadShareLink, parseSharedId } from "../src/core/shareLink";

const target = {
  pullRequestUrl: "https://dev.azure.com/prxm/Jarvis/_git/Jarvis/pullrequest/4804",
  tabId: "NebulaImprover.advanced-pr.advanced-pr-tab",
  filePath: "src/Intranet/Jarvis.Common.Shared/Search/Es/OmniSearchRequest.cs",
  threadId: 1234,
  commentId: 7,
};

describe("thread share link", () => {
  it("points at the tab, the file and the thread", () => {
    expect(buildThreadShareLink(target)).toBe(
      "https://dev.azure.com/prxm/Jarvis/_git/Jarvis/pullrequest/4804" +
        "?_a=NebulaImprover.advanced-pr.advanced-pr-tab" +
        "&path=/src/Intranet/Jarvis.Common.Shared/Search/Es/OmniSearchRequest.cs" +
        "&threadId=1234" +
        "&commentId=7",
    );
  });

  it("replaces the query and fragment the pull request url already carried", () => {
    const link = buildThreadShareLink({
      ...target,
      pullRequestUrl: `${target.pullRequestUrl}?_a=files&path=/other.ts#anchor`,
    });
    expect(link.startsWith(`${target.pullRequestUrl}?_a=NebulaImprover`)).toBe(true);
    expect(link).not.toContain("other.ts");
  });

  it("roots the path and escapes what is not a separator", () => {
    const link = buildThreadShareLink({ ...target, filePath: "/src/a b/c#d.ts" });
    expect(link).toContain("&path=/src/a%20b/c%23d.ts&");
  });

  it("reads back only a usable id", () => {
    expect(parseSharedId("1234")).toBe(1234);
    expect(parseSharedId(undefined)).toBeUndefined();
    expect(parseSharedId("")).toBeUndefined();
    expect(parseSharedId("nope")).toBeUndefined();
    expect(parseSharedId("-3")).toBeUndefined();
    expect(parseSharedId("1.5")).toBeUndefined();
  });
});
