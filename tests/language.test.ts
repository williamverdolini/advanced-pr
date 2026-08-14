import { describe, expect, it } from "vitest";
import { languageForPath } from "../src/core/language";

describe("language for path", () => {
  it("maps a known extension, whatever its case", () => {
    expect(languageForPath("src/core/ledger.ts")).toBe("typescript");
    expect(languageForPath("Program.CS")).toBe("csharp");
  });

  it("falls back to plain text for anything unknown", () => {
    expect(languageForPath("Dockerfile")).toBe("plaintext");
    expect(languageForPath("assets/logo.png")).toBe("plaintext");
    expect(languageForPath("")).toBe("plaintext");
  });
});
