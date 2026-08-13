import * as React from "react";
import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "../core/markdown";

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
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
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
          default:
            return <React.Fragment key={index}>{node.value}</React.Fragment>;
        }
      })}
    </>
  );
}
