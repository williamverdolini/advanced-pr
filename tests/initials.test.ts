import { describe, expect, it } from "vitest";
import { initialsFromName } from "../src/core/initials";

describe("initials from a display name", () => {
  it("takes the first letter of the first and last part", () => {
    expect(initialsFromName("William Verdolini")).toBe("WV");
    expect(initialsFromName("Matteo Galletti")).toBe("MG");
  });

  it("skips a middle name rather than the surname", () => {
    expect(initialsFromName("Maria Luisa Rossi")).toBe("MR");
  });

  it("reads a surname-first name the same way", () => {
    expect(initialsFromName("Rossi, Maria")).toBe("RM");
  });

  it("handles one word, and a name written as an address", () => {
    expect(initialsFromName("Build")).toBe("B");
    expect(initialsFromName("maria.rossi")).toBe("MR");
  });

  it("drops what an organization puts in brackets", () => {
    expect(initialsFromName("Maria Rossi (Contractor)")).toBe("MR");
  });

  it("falls back to a question mark when there is no letter", () => {
    expect(initialsFromName("   ")).toBe("?");
    expect(initialsFromName("")).toBe("?");
  });
});
