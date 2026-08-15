import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  collectFiles,
  collectFolderPaths,
  nextFileToReview,
} from "../src/core/fileTree";
import type { ChangedFile } from "../src/platform/azureDevOpsClient";

function file(path: string): ChangedFile {
  return { path, changeTrackingId: path.length, changeKind: "edit" };
}

describe("file tree", () => {
  it("groups files by folder and exposes all descendant paths", () => {
    const tree = buildFileTree([
      file("src/api/client.ts"),
      file("src/api/types.ts"),
      file("src/index.ts"),
      file("README.md"),
    ]);

    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    const src = tree[0];
    expect(src.kind).toBe("folder");
    if (src.kind === "folder") {
      expect(src.filePaths).toEqual([
        "src/api/client.ts",
        "src/api/types.ts",
        "src/index.ts",
      ]);
    }
  });

  it("collects every nested folder for the initial expanded state", () => {
    const tree = buildFileTree([
      file("src/api/generated/client.ts"),
      file("docs/README.md"),
    ]);

    expect(collectFolderPaths(tree)).toEqual([
      "docs",
      "src",
      "src/api",
      "src/api/generated",
    ]);
  });

  it("lists files in the order the tree shows them, not the order they arrive", () => {
    const files = [file("src/zeta.ts"), file("README.md"), file("src/alpha.ts")];

    expect(collectFiles(buildFileTree(files)).map((entry) => entry.path)).toEqual([
      "src/alpha.ts",
      "src/zeta.ts",
      "README.md",
    ]);
  });

  it("lands on the first file not yet viewed, in that same order", () => {
    const files = [file("src/zeta.ts"), file("README.md"), file("src/alpha.ts")];

    expect(nextFileToReview(files, new Set())?.path).toBe("src/alpha.ts");
    expect(nextFileToReview(files, new Set(["src/alpha.ts"]))?.path).toBe("src/zeta.ts");
    expect(
      nextFileToReview(files, new Set(["src/alpha.ts", "src/zeta.ts"]))?.path,
    ).toBe("README.md");
  });

  it("falls back to the first file when everything has been viewed", () => {
    const files = [file("src/zeta.ts"), file("src/alpha.ts")];
    const allViewed = new Set(["src/zeta.ts", "src/alpha.ts"]);

    expect(nextFileToReview(files, allViewed)?.path).toBe("src/alpha.ts");
    expect(nextFileToReview([], new Set())).toBeUndefined();
  });
});
