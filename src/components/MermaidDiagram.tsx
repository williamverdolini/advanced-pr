import * as React from "react";
import { observeHostTheme, type HostTheme } from "../platform/hostTheme";

export interface MermaidDiagramProps {
  source: string;
}

type MermaidModule = typeof import("mermaid").default;

// Loaded on first use: the library is several times the size of the rest of the
// bundle, and most files and comments never contain a diagram.
let mermaidPromise: Promise<MermaidModule> | undefined;
let renderCount = 0;
// Mermaid keeps one global configuration and renders with whatever was set last,
// so renders are queued: two diagrams rendering at once under different themes
// would otherwise take each other's colours.
let renderQueue: Promise<unknown> = Promise.resolve();

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

function renderDiagram(source: string, theme: HostTheme): Promise<string> {
  const rendering = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      // Strict sanitizes the labels and drops click handlers: the source is
      // written by other people, in a page holding an Azure DevOps token.
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      // The diagram is shown as an image, where HTML inside `foreignObject` is
      // not reliably painted; SVG text always is.
      htmlLabels: false,
    });
    renderCount += 1;
    const { svg } = await mermaid.render(`mermaid-diagram-${renderCount}`, source);
    return svg;
  });
  renderQueue = rendering.catch(() => undefined);

  return rendering;
}

/**
 * A fenced `mermaid` block drawn as the diagram it describes. The SVG is shown
 * through an `<img>` rather than inserted into the page: an image cannot run
 * script or reach the document, so nothing in the source can, whatever the
 * sanitizer misses, and no `dangerouslySetInnerHTML` is needed.
 */
export function MermaidDiagram({ source }: MermaidDiagramProps): React.ReactElement {
  const [theme, setTheme] = React.useState<HostTheme>("light");
  const [result, setResult] = React.useState<{ svg?: string; error?: string }>({});

  React.useEffect(() => observeHostTheme(setTheme), []);

  React.useEffect(() => {
    let active = true;
    renderDiagram(source, theme).then(
      (svg) => {
        if (active) {
          setResult({ svg });
        }
      },
      (error: unknown) => {
        if (active) {
          setResult({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [source, theme]);

  // A data URL rather than an object URL: it needs no revoking, and the diagram
  // is small next to what a page already holds.
  const image = React.useMemo(
    () =>
      result.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}` : undefined,
    [result.svg],
  );

  if (result.error !== undefined) {
    // The source is still worth reading when it does not parse: it is what the
    // author meant, and the error says where it went wrong.
    return (
      <div className="mermaid-diagram failed">
        <p className="mermaid-diagram-error">Unable to draw this diagram: {result.error}</p>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  if (!image) {
    return <div className="mermaid-diagram loading">Drawing diagram…</div>;
  }

  return (
    <div className="mermaid-diagram">
      <img src={image} alt="Mermaid diagram" />
    </div>
  );
}
