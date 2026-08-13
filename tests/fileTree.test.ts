import { describe, expect, it } from "vitest";
import { buildFileTree, collectFolderPaths } from "../src/core/fileTree";
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
});