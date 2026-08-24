import * as React from "react";
import {
  parseMarkdown,
  safeImageHref,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownTableAlignment,
} from "../core/markdown";
import { AttachmentContext } from "./attachmentContext";
import { MentionContext } from "./mentionContext";

export interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renders comment Markdown as React elements. There is deliberately no
 * `dangerouslySetInnerHTML` anywhere in this file: comment text comes from
 * other users, so markup can never be constructed from it.
 */
export function Markdown({ content, className }: MarkdownProps): React.ReactElement {
  const blocks = React.useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={className ? `markdown-body ${className}` : "markdown-body"}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

/** Undefined leaves the alignment to the stylesheet, which is what the default is. */
function alignment(value: MarkdownTableAlignment): React.CSSProperties | undefined {
  return value ? { textAlign: value } : undefined;
}

function Block({ block }: { block: MarkdownBlock }): React.ReactElement {
  switch (block.kind) {
    case "codeBlock":
      return (
        <pre>
          <code>{block.value}</code>
        </pre>
      );
    case "heading": {
      const Tag = `h${Math.min(6, block.level + 2)}` as "h3";
      return (
        <Tag>
          <Inline nodes={block.content} />
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote>
          <Lines lines={block.lines} />
        </blockquote>
      );
    case "list":
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        // The table keeps its own scroll: a column of prose in a narrow pane
        // wraps, but a table wide enough to need it must not take the page
        // sideways with it.
        <div className="markdown-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} style={alignment(block.alignments[index])}>
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={alignment(block.alignments[index])}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p>
          <Lines lines={block.lines} />
        </p>
      );
  }
}

function Lines({ lines }: { lines: MarkdownInline[][] }): React.ReactElement {
  return (
    <>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 && <br />}
          <Inline nodes={line} />
        </React.Fragment>
      ))}
    </>
  );
}

function Inline({ nodes }: { nodes: MarkdownInline[] }): React.ReactElement {
  const resolveMention = React.useContext(MentionContext);

  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "mention": {
            const identity = resolveMention?.(node.id);
            return (
              <span
                key={index}
                className={identity ? "mention" : "mention unresolved"}
                title={identity?.uniqueName ?? identity?.displayName ?? node.id}
              >
                @{identity?.displayName ?? "unknown"}
              </span>
            );
          }
          case "strong":
            return (
              <strong key={index}>
                <Inline nodes={node.children} />
              </strong>
            );
          case "emphasis":
            return (
              <em key={index}>
                <Inline nodes={node.children} />
              </em>
            );
          case "code":
            return <code key={index}>{node.value}</code>;
          case "link":
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <Inline nodes={node.children} />
              </a>
            );
          case "image":
            return <InlineImage key={index} alt={node.alt} href={node.href} />;
          default:
            return <React.Fragment key={index}>{node.value}</React.Fragment>;
        }
      })}
    </>
  );
}

/**
 * An image in a comment. The href never reaches the element as it is: a pull
 * request attachment has to be read through the REST client, and an upload still
 * in flight has no href at all, in which case the alternative text — the file
 * name the editor wrote — stands in for the picture. The attachment service
 * decides; without one, only a URL the browser can load by itself is any use.
 */
function InlineImage({ alt, href }: { alt: string; href: string }): React.ReactElement {
  const attachments = React.useContext(AttachmentContext);
  const [source, setSource] = React.useState<string>();
  const [fellBack, setFellBack] = React.useState(false);
  const direct = safeImageHref(href);

  React.useEffect(() => {
    let active = true;
    const resolved = attachments
      ? attachments.resolveImage(href, alt)
      : Promise.resolve(safeImageHref(href));

    void resolved.then(
      (loadable) => {
        if (active) {
          setFellBack(false);
          setSource(loadable);
        }
      },
      () => {
        if (active) {
          setSource(undefined);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [alt, attachments, href]);

  // The object URL was refused — a content policy on the page can do that — so
  // the href itself is worth one attempt before the picture is given up on.
  const retryOrGiveUp = (): void => {
    if (fellBack || !direct || direct === source) {
      setSource(undefined);

      return;
    }

    setFellBack(true);
    setSource(direct);
  };

  if (!source) {
    return (
      <span className="markdown-image-placeholder" title={href}>
        {alt || "image"}
      </span>
    );
  }

  return (
    <img
      className="markdown-image"
      src={source}
      alt={alt}
      title={alt}
      onError={retryOrGiveUp}
    />
  );
}
