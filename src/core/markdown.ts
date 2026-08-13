export type MarkdownInline =
  | { kind: "text"; value: string }
  | { kind: "strong"; children: MarkdownInline[] }
  | { kind: "emphasis"; children: MarkdownInline[] }
  | { kind: "code"; value: string }
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

const inlinePattern =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([\s\S]+?)\*|_([\s\S]+?)_|\[([^\]]*)\]\(([^)\s]+)\)/;

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

    const [, , codeValue, strongStars, strongUnderscores, emphasisStar, emphasisUnderscore, linkText, linkHref] =
      match;

    if (codeValue !== undefined) {
      nodes.push({ kind: "code", value: codeValue.trim() });
    } else if (strongStars ?? strongUnderscores) {
      nodes.push({ kind: "strong", children: parseInline(strongStars ?? strongUnderscores) });
    } else if (emphasisStar ?? emphasisUnderscore) {
      nodes.push({
        kind: "emphasis",
        children: parseInline(emphasisStar ?? emphasisUnderscore),
      });
    } else if (linkHref !== undefined) {
      const href = safeLinkHref(linkHref);
      const children = parseInline(linkText || linkHref);
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
