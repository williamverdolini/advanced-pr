import { describe, expect, it } from "vitest";
import {
  mergeMentionDirectory,
  toDisplayText,
  toStoredText,
} from "../src/core/mentionText";

const willId = "8bd95966-6f7d-4654-9097-300bfb3d7ee7";
const annaId = "d850f381-b771-468a-8b47-fe7d9ff8b992";

const people: Record<string, string> = {
  [willId]: "William Verdolini",
  [annaId]: "Anna Bianchi",
};
const resolve = (id: string) =>
  people[id] ? { displayName: people[id] } : undefined;

describe("mention display text", () => {
  it("shows names instead of tokens, and remembers the way back", () => {
    const { text, names } = toDisplayText(`@<${willId.toUpperCase()}> ciao`, resolve);

    expect(text).toBe("@William Verdolini ciao");
    expect(names.get("william verdolini")).toBe(willId);
  });

  it("keeps a token it cannot resolve, rather than losing the mention", () => {
    const unknown = "11111111-2222-3333-4444-555555555555";
    const { text } = toDisplayText(`@<${unknown}> ciao`, resolve);

    expect(text).toBe(`@<${unknown}> ciao`);
  });

  it("round-trips through the stored form", () => {
    const stored = `@<${willId.toUpperCase()}> e @<${annaId.toUpperCase()}> ok`;
    const { text, names } = toDisplayText(stored, resolve);

    expect(toStoredText(text, names)).toBe(stored);
  });

  it("only converts names the directory knows", () => {
    const directory = new Map([["william verdolini", willId]]);

    expect(toStoredText("@William Verdolini e @Qualcun Altro", directory)).toBe(
      `@<${willId.toUpperCase()}> e @Qualcun Altro`,
    );
  });

  it("does not fabricate a mention from an email address", () => {
    const directory = new Map([["william verdolini", willId]]);

    expect(toStoredText("scrivi a nome@William Verdolini.it", directory)).toBe(
      "scrivi a nome@William Verdolini.it",
    );
  });

  it("prefers the longest matching name", () => {
    const directory = new Map([
      ["anna", annaId],
      ["anna bianchi", willId],
    ]);

    expect(toStoredText("@Anna Bianchi", directory)).toBe(`@<${willId.toUpperCase()}>`);
  });

  it("drops a name claimed by two identities rather than guessing", () => {
    const merged = mergeMentionDirectory(
      new Map([["mario rossi", willId]]),
      new Map([["mario rossi", annaId]]),
    );

    expect(merged.has("mario rossi")).toBe(false);
    expect(toStoredText("@Mario Rossi", merged)).toBe("@Mario Rossi");
  });
});
