/**
 * Folding ranges for a brace language, with the range starting on the line that
 * says what the block *is*.
 *
 * Monaco derives folding — and with it the sticky header at the top of the
 * editor — from indentation whenever the language has no folding provider,
 * which for a bundle that ships C# and Java as a tokenizer alone is always. In
 * a brace-on-its-own-line style the line where the indentation increases is the
 * brace, so the sticky header reads `{` and the reader learns nothing: the
 * `foreach`, the `if`, the method signature are all on the line above.
 *
 * These ranges are the same ranges, moved up onto that line. Nothing else about
 * folding changes, which is why the computation below is a port of Monaco's own
 * rather than a second opinion on it.
 */

export interface FoldingRange {
  /** 1-based, and the line the sticky header shows for this block. */
  readonly start: number;
  readonly end: number;
}

/** Region comments, per language: `#region` in C#, `// #region` in Java. */
export interface FoldingMarkers {
  readonly start: RegExp;
  readonly end: RegExp;
}

export interface BlockFoldingOptions {
  readonly tabSize?: number;
  readonly markers?: FoldingMarkers;
  /** Languages where a blank line belongs to the block above it. */
  readonly offSide?: boolean;
}

export function computeBlockFoldingRanges(
  lines: readonly string[],
  { tabSize = 4, markers, offSide = false }: BlockFoldingOptions = {},
): readonly FoldingRange[] {
  return indentationRanges(lines, tabSize, markers, offSide).map((range) => ({
    ...range,
    start: headerLine(lines, range.start, tabSize),
  }));
}

/**
 * The line that introduces the block whose brace sits on `braceLine`, or
 * `braceLine` itself when there is none to move to.
 *
 * Only a line whose entire content is `{` is moved off, which is what makes
 * this safe without lexing: a brace inside a string or a comment always has
 * something else on its line. What it walks past on the way up is a wrapped
 * signature — the deeper-indented remainder of `Method(\n  a,\n  b)` — and
 * comments; what stops it is a complete statement, another brace, or an
 * indentation that says the block has no header at all.
 */
function headerLine(lines: readonly string[], braceLine: number, tabSize: number): number {
  const braceIndex = braceLine - 1;
  if (lines[braceIndex]?.trim() !== "{") {
    return braceLine;
  }

  const braceIndent = indentLevel(lines[braceIndex], tabSize);
  for (let index = braceIndex - 1; index >= 0; index--) {
    const text = lines[index].trim();
    const indent = indentLevel(lines[index], tabSize);

    if (indent === -1 || isCommentOnly(text)) {
      continue;
    }
    if (indent > braceIndent) {
      continue;
    }
    if (indent < braceIndent) {
      return braceLine;
    }
    // A line that closes something is not the header of what follows it, and
    // neither is a statement of its own: `x();` above a bare scope block.
    return /[;{}]$/.test(text) ? braceLine : index + 1;
  }

  return braceLine;
}

function isCommentOnly(text: string): boolean {
  return text.startsWith("//") || text.startsWith("/*") || text.startsWith("*");
}

/**
 * Monaco's `computeRanges`, ported: same backward walk, same sentinel, same
 * treatment of region markers as frames with an indent of -2. Deliberately
 * line-for-line with the original, because the point of this module is to move
 * the ranges Monaco would have produced, not to produce different ones.
 */
function indentationRanges(
  lines: readonly string[],
  tabSize: number,
  markers: FoldingMarkers | undefined,
  offSide: boolean,
): FoldingRange[] {
  const pattern = markers
    ? new RegExp(`(${markers.start.source})|(?:${markers.end.source})`)
    : undefined;
  const ranges: FoldingRange[] = [];
  const previousRegions: { indent: number; endAbove: number; line: number }[] = [];
  const afterLast = lines.length + 1;
  previousRegions.push({ indent: -1, endAbove: afterLast, line: afterLast });

  for (let line = lines.length; line > 0; line--) {
    const lineContent = lines[line - 1];
    const indent = indentLevel(lineContent, tabSize);
    let previous = previousRegions[previousRegions.length - 1];

    if (indent === -1) {
      if (offSide) {
        previous.endAbove = line;
      }
      continue;
    }

    const match = pattern ? lineContent.match(pattern) : null;
    if (match) {
      if (match[1]) {
        // A region start closes every frame down to the matching end marker.
        let index = previousRegions.length - 1;
        while (index > 0 && previousRegions[index].indent !== -2) {
          index--;
        }
        if (index > 0) {
          previousRegions.length = index + 1;
          previous = previousRegions[index];
          // The region includes its end line, unlike an indentation range.
          ranges.unshift({ start: line, end: previous.line });
          previous.line = line;
          previous.indent = indent;
          previous.endAbove = line;
          continue;
        }
        // No end marker below: the line is just a line.
      } else {
        previousRegions.push({ indent: -2, endAbove: line, line });
        continue;
      }
    }

    if (previous.indent > indent) {
      do {
        previousRegions.pop();
        previous = previousRegions[previousRegions.length - 1];
      } while (previous.indent > indent);

      const endLineNumber = previous.endAbove - 1;
      if (endLineNumber - line >= 1) {
        ranges.unshift({ start: line, end: endLineNumber });
      }
    }

    if (previous.indent === indent) {
      previous.endAbove = line;
    } else {
      previousRegions.push({ indent, endAbove: line, line });
    }
  }

  return ranges;
}

/** Monaco's `computeIndentLevel`: -1 for a line that is only whitespace. */
function indentLevel(line: string, tabSize: number): number {
  let indent = 0;
  for (const character of line) {
    if (character === " ") {
      indent++;
    } else if (character === "\t") {
      indent = indent - (indent % tabSize) + tabSize;
    } else {
      return indent;
    }
  }
  return -1;
}
