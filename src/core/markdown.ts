export type MarkdownInline =
  | { kind: "text"; value: string }
  | { kind: "strong"; children: MarkdownInline[] }
  | { kind: "emphasis"; children: MarkdownInline[] }
  | { kind: "code"; value: string }
  | { kind: "mention"; id: string }
  | { kind: "link"; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { kind: "paragraph"; lines: MarkdownInline[][] }
  | { kind: "heading"; level: number; content: MarkdownInline[] }
  | { kind: "quote"; lines: MarkdownInline[][] }
  | { kind: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { kind: "codeBlock"; language?: string; value: string };

/**
 * The subset of Markdown the comment editor can produce, parsed into a tree of
 * plain values. Nothing here yields HTML: the renderer builds React elements,
 * so comment text, which is authored by other users and displayed inside an
 * iframe holding an Azure DevOps token, can never inject markup.
 */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence, or end of input
      blocks.push({
        kind: "codeBlock",
        language: fence[1] || undefined,
        value: content.join("\n"),
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: MarkdownInline[][] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(parseInline(lines[index].replace(/^>\s?/, "")));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/;
    const numbered = /^\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: MarkdownInline[][] = [];
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(parseInline(lines[index].match(pattern)![1]));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: MarkdownInline[][] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !bullet.test(lines[index]) &&
      !numbered.test(lines[index])
    ) {
      paragraph.push(parseInline(lines[index]));
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

/** Azure DevOps writes a mention as `@<GUID>`, upper-cased, in the comment text. */
const guidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// Named groups rather than positions: the alternation is long enough that
// adding one more branch would silently shift every index.
const inlinePattern = new RegExp(
  [
    "(?<fence>`+)(?<code>[\\s\\S]*?)\\k<fence>",
    `@<(?<mention>${guidPattern})>`,
    "\\*\\*(?<strongStars>[\\s\\S]+?)\\*\\*",
    "__(?<strongUnderscores>[\\s\\S]+?)__",
    "\\*(?<emphasisStar>[\\s\\S]+?)\\*",
    "_(?<emphasisUnderscore>[\\s\\S]+?)_",
    "\\[(?<linkText>[^\\]]*)\\]\\((?<linkHref>[^)\\s]+)\\)",
  ].join("|"),
);

/**
 * Flattens comment Markdown to a single line, for places that show a summary
 * rather than the comment itself. Mentions become the person's name: the raw
 * `@<GUID>` token is unreadable, and it is what the tree used to show.
 */
export function toPlainText(
  content: string,
  resolveMention?: (id: string) => { displayName: string } | undefined,
): string {
  const flattenInline = (nodes: readonly MarkdownInline[]): string =>
    nodes
      .map((node) => {
        switch (node.kind) {
          case "text":
            return node.value;
          case "code":
            return node.value;
          case "mention":
            return `@${resolveMention?.(node.id)?.displayName ?? "unknown"}`;
          default:
            return flattenInline(node.children);
        }
      })
      .join("");

  return parseMarkdown(content)
    .map((block) => {
      switch (block.kind) {
        case "codeBlock":
          return block.value;
        case "heading":
          return flattenInline(block.content);
        case "list":
          return block.items.map(flattenInline).join(" ");
        default:
          return block.lines.map(flattenInline).join(" ");
      }
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every identity mentioned in a piece of text, lower-cased for comparison. */
export function findMentionIds(text: string): string[] {
  return [...text.matchAll(new RegExp(`@<(${guidPattern})>`, "g"))].map((match) =>
    match[1].toLowerCase(),
  );
}

export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let rest = text;

  while (rest) {
    const match = rest.match(inlinePattern);
    if (!match || match.index === undefined) {
      nodes.push({ kind: "text", value: rest });
      break;
    }

    if (match.index > 0) {
      nodes.push({ kind: "text", value: rest.slice(0, match.index) });
    }

    const groups = match.groups ?? {};

    if (groups.code !== undefined) {
      nodes.push({ kind: "code", value: groups.code.trim() });
    } else if (groups.mention !== undefined) {
      nodes.push({ kind: "mention", id: groups.mention.toLowerCase() });
    } else if (groups.strongStars ?? groups.strongUnderscores) {
      nodes.push({
        kind: "strong",
        children: parseInline(groups.strongStars ?? groups.strongUnderscores),
      });
    } else if (groups.emphasisStar ?? groups.emphasisUnderscore) {
      nodes.push({
        kind: "emphasis",
        children: parseInline(groups.emphasisStar ?? groups.emphasisUnderscore),
      });
    } else if (groups.linkHref !== undefined) {
      const href = safeLinkHref(groups.linkHref);
      const children = parseInline(groups.linkText || groups.linkHref);
      nodes.push(href ? { kind: "link", href, children } : { kind: "text", value: match[0] });
    }

    rest = rest.slice(match.index + match[0].length);
  }

  return nodes;
}

/**
 * Only schemes that cannot execute script survive; anything else is rendered as
 * plain text rather than becoming a clickable `javascript:` payload.
 */
export function safeLinkHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(https?:|mailto:)/i.test(value)) {
    return value;
  }

  return /^[/#]/.test(value) ? value : undefined;
}
