import { describe, expect, it } from "vitest";
import {
  classifyFileChange,
  contentSideForChange,
  isContentOnlyChange,
} from "../src/core/changeType";

// VersionControlChangeType is a flags enum: Add 1, Edit 2, Encoding 4,
// Rename 8, Delete 16, Undelete 32, Branch 64, SourceRename 1024.
describe("file change classification", () => {
  it("reads the plain change types", () => {
    expect(classifyFileChange(1)).toBe("add");
    expect(classifyFileChange(2)).toBe("edit");
    expect(classifyFileChange(16)).toBe("delete");
    expect(classifyFileChange(8)).toBe("rename");
  });

  it("reads the combinations Azure DevOps actually sends", () => {
    expect(classifyFileChange(8 | 2)).toBe("rename");
    expect(classifyFileChange(1 | 64)).toBe("add");
    expect(classifyFileChange(32 | 1)).toBe("add");
    expect(classifyFileChange(1024 | 2)).toBe("rename");
    expect(classifyFileChange(16 | 2)).toBe("delete");
  });

  it("treats unknown or missing values as a modification", () => {
    expect(classifyFileChange(0)).toBe("edit");
    expect(classifyFileChange(undefined)).toBe("edit");
    expect(classifyFileChange(4)).toBe("edit");
  });

  it("shows one-sided changes as plain content, and from the side that has it", () => {
    expect(isContentOnlyChange("add")).toBe(true);
    expect(isContentOnlyChange("delete")).toBe(true);
    expect(isContentOnlyChange("edit")).toBe(false);
    expect(isContentOnlyChange("rename")).toBe(false);

    expect(contentSideForChange("add")).toBe("right");
    expect(contentSideForChange("delete")).toBe("left");
    expect(contentSideForChange("edit")).toBe("right");
  });
});
