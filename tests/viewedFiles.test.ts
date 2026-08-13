import { describe, expect, it } from "vitest";
import {
  createViewedFileRevisions,
  reconcileViewedFiles,
} from "../src/core/viewedFiles";

describe("viewed files", () => {
  it("preserves only files whose path and blob revision are unchanged", () => {
    const before = [
      { path: "src/same.ts", objectId: "blob-a" },
      { path: "src/changed.ts", objectId: "blob-b" },
      { path: "src/renamed.ts", objectId: "blob-c" },
    ];
    const stored = createViewedFileRevisions(before, new Set(before.map((file) => file.path)));
    const after = [
      { path: "src/same.ts", objectId: "blob-a" },
      { path: "src/changed.ts", objectId: "blob-b2" },
      { path: "src/new-name.ts", objectId: "blob-c" },
    ];

    expect([...reconcileViewedFiles(after, stored)]).toEqual(["src/same.ts"]);
  });
});