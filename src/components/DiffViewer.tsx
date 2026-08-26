import * as React from "react";
import * as ReactDOM from "react-dom";
import * as monaco from "monaco-editor";
import { observeHostTheme } from "../platform/hostTheme";
import { registerBlockFolding } from "./registerBlockFolding";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
};

(globalThis as MonacoGlobal).MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") {
      return new JsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new CssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new TypeScriptWorker();
    }
    return new EditorWorker();
  },
};

// Module scope, like the environment above: the providers belong to the Monaco
// singleton, not to an editor instance.
registerBlockFolding();

export interface DiffViewerProps<TZone extends DiffZoneAnchor> {
  original: string;
  modified: string;
  language: string;
  filePath: string;
  /**
   * Inline regions to mount inside the diff, one view zone each. Identity is
   * carried by `key`: an anchor that keeps its key keeps its DOM node, and with
   * it the React state of whatever `renderZone` puts inside (reply drafts,
   * expanded state). Must be memoized by the caller.
   */
  zones?: readonly TZone[];
  renderZone?: (zone: TZone) => React.ReactNode;
  /** Inline (unified) by default; side by side renders the original editor. */
  renderSideBySide?: boolean;
  /**
   * Renders one side in a plain read-only editor instead of a diff. Used for
   * files that exist on a single side: an added file shows its new content, a
   * deleted one what it used to hold.
   */
  singleFile?: boolean;
  /** Which side the single editor shows. Ignored when rendering a diff. */
  singleFileSide?: DiffSideKey;
  /**
   * Wraps long lines instead of scrolling sideways. On a narrow screen the
   * horizontal scroll is the difference between reading the code and hunting
   * for it, and with no scroll left the comment zones stop needing their
   * horizontal pinning.
   */
  wordWrap?: boolean;
  /**
   * Renders space and tab glyphs, and stops the comparison ignoring a change
   * that is whitespace only. Off by default: a reformatting commit is unreadable
   * with every space marked, and a whitespace-only change is usually noise —
   * except when it is the change, which is what this is for.
   */
  showWhitespace?: boolean;
  /**
   * Keeps the enclosing scopes pinned above the code while it scrolls. On by
   * default, which is Monaco's own default: the switch exists because the lines
   * it pins are worth little in a language the bundle cannot outline, and
   * because it costs height a phone does not have.
   */
  stickyScroll?: boolean;
  threadDecorations?: readonly DiffThreadDecoration[];
  selectedThreadId?: number;
  revealTarget?: DiffRevealTarget;
  onSelectionChange?: (selection: DiffSelection | undefined) => void;
  /** Fired by the "add comment" affordance in the glyph margin. */
  onRequestComment?: (anchor: DiffSelection) => void;
  /** Fired when the glyph of an existing thread is clicked. */
  onSelectThread?: (threadId: number) => void;
  /**
   * Handed the imperative commands once the editor exists, and `undefined` when
   * it goes away. A callback rather than a ref: the caller puts it in state and
   * builds its toolbar from that, and nothing has to read a ref while
   * rendering.
   */
  onApiReady?: (api?: DiffViewerApi) => void;
  /**
   * Number of differences, once Monaco's worker has computed them. Reported on
   * every recomputation, because it is only known asynchronously.
   */
  onDiffUpdated?: (differences: number) => void;
}

/** Imperative commands the diff exposes to the surrounding toolbar. */
export interface DiffViewerApi {
  goToDiff(direction: "next" | "previous"): void;
}

export interface DiffZoneAnchor {
  key: string;
  side: "left" | "right";
  /** 0 mounts the zone above the first line, for file-level threads. */
  afterLineNumber: number;
}

export interface DiffThreadDecoration {
  id: number;
  side: "left" | "right";
  line: number;
  isOpen: boolean;
}

export interface DiffRevealTarget {
  side: "left" | "right";
  line: number;
}

export interface DiffSelection {
  side: "left" | "right";
  startLine: number;
  startOffset: number;
  endLine: number;
  endOffset: number;
}

type DiffSideKey = "left" | "right";

/**
 * Hides whether the content is shown as a diff or as a single file, so zones,
 * decorations and glyph handling have one code path.
 */
interface EditorHandle {
  readonly kind: "diff" | "single";
  goToDiff(direction: "next" | "previous"): void;
  differenceCount(): number;
  onDidUpdateDiff(callback: () => void): monaco.IDisposable | undefined;
  /** The only side rendered in single mode; both sides exist in diff mode. */
  readonly side: DiffSideKey;
  sideEditor(side: DiffSideKey): monaco.editor.ICodeEditor;
  setModels(models: { original?: monaco.editor.ITextModel; modified: monaco.editor.ITextModel }): void;
  clearModels(): void;
  setSideBySide(value: boolean): void;
  /**
   * Reading options — wrapping, whitespace marks, the sticky header — set on
   * the pair rather than on either editor. A diff editor re-derives both of its
   * children's options from its own whenever any of them changes, so anything
   * written straight onto a child survives only until the next change.
   */
  setTextOptions(options: monaco.editor.IEditorOptions): void;
  /** Whether a change made only of whitespace counts as a difference. */
  setWhitespaceInDiff(value: boolean): void;
  dispose(): void;
}

interface MountedZone {
  key: string;
  zoneId: string;
  side: "left" | "right";
  afterLineNumber: number;
  /** Owned by Monaco: its height is driven by `zone.heightInPx`. */
  container: HTMLElement;
  /** Content-sized wrapper: measured by the observer, target of the portal. */
  content: HTMLElement;
  zone: monaco.editor.IViewZone;
  height: number;
  dispose: () => void;
}

const noZones: readonly never[] = [];

/**
 * Zones must never be created with a height of 0: Monaco hides whitespaces it
 * does not consider visible, a hidden element has no box, and a ResizeObserver
 * never reports on it: the zone would stay collapsed forever, and clicks over
 * its area would be handled as clicks on the code underneath.
 */
const provisionalZoneHeight = 120;

/**
 * How long a requested line stays worth chasing while the view settles. Long
 * enough to outlast the diff computation and the measurement of every comment
 * zone on the file, short enough that scrolling away a moment later is never
 * undone under the reader.
 */
const revealSettleWindow = 1500;

export function DiffViewer<TZone extends DiffZoneAnchor>({
  original,
  modified,
  language,
  filePath,
  zones = noZones,
  renderZone,
  renderSideBySide = false,
  singleFile = false,
  singleFileSide = "right",
  wordWrap = false,
  showWhitespace = false,
  stickyScroll = true,
  threadDecorations = [],
  selectedThreadId,
  revealTarget,
  onSelectionChange,
  onRequestComment,
  onSelectThread,
  onApiReady,
  onDiffUpdated,
}: DiffViewerProps<TZone>): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<EditorHandle>();
  const modelsRef = React.useRef<monaco.editor.ITextModel[]>([]);
  const decorationCollectionsRef = React.useRef<monaco.editor.IEditorDecorationsCollection[]>([]);
  const mountedZonesRef = React.useRef(new Map<string, MountedZone>());
  const measuredNodesRef = React.useRef(new Map<Element, MountedZone>());
  const observerRef = React.useRef<ResizeObserver>();
  const hoverCollectionsRef = React.useRef<
    Partial<Record<DiffSideKey, monaco.editor.IEditorDecorationsCollection>>
  >({});
  /** line number → thread id, per side: drives both the glyph click and the "+". */
  const commentedLinesRef = React.useRef<Record<DiffSideKey, ReadonlyMap<number, number>>>({
    left: new Map(),
    right: new Map(),
  });
  const [zoneNodes, setZoneNodes] = React.useState<ReadonlyMap<string, HTMLElement>>(new Map());
  /** The line still to be brought into view, and how long it stays worth chasing. */
  const pendingRevealRef = React.useRef<{ target: DiffRevealTarget; until: number }>();

  // Revealing a line once is not enough: the diff worker aligns the two sides
  // after the models are set, and every comment zone only gets its real height
  // once React has drawn it, so content below keeps moving for a moment. The
  // target is re-applied on each of those shifts instead, which is what makes a
  // link to a comment far down a long file actually land on it.
  const applyPendingReveal = React.useCallback((): void => {
    const pending = pendingRevealRef.current;
    const editor = editorRef.current;
    if (!pending || !editor) {
      return;
    }

    if (Date.now() > pending.until) {
      pendingRevealRef.current = undefined;
      return;
    }

    const sideEditor = editor.sideEditor(pending.target.side);
    const model = sideEditor.getModel();
    if (!model) {
      return;
    }

    // Clamped against the model, not just against 1: Monaco throws on a line it
    // does not have, and there is a window where it does not have this one. The
    // reveal outlives the click that asked for it — it is re-applied as the diff
    // and every comment zone settle — so it can run while the editor still holds
    // the file that was open before, which may be shorter than the line asked
    // for. The throw came out of a ResizeObserver, where nothing catches it, and
    // took the whole tab white. Being re-applied is also why clamping is enough:
    // the next pass, once the right model is in, lands on the real line.
    const line = Math.min(Math.max(1, pending.target.line), model.getLineCount());
    // The comment is a view zone hanging under its line, and it is the comment
    // that was asked for: scrolling to where the line ends puts the card itself
    // at the top of the screen. `getBottomForLineNumber` is that offset — the
    // lines and zones above it, without the zone that follows it.
    sideEditor.setScrollTop(sideEditor.getBottomForLineNumber(line));
  }, []);

  // Editor creation must happen exactly once: recreating it would drop every
  // mounted zone. Callbacks therefore travel through a ref instead of deps.
  const callbacksRef = React.useRef({
    onSelectionChange,
    onRequestComment,
    onSelectThread,
    onApiReady,
    onDiffUpdated,
  });

  React.useEffect(() => {
    callbacksRef.current = {
      onSelectionChange,
      onRequestComment,
      onSelectThread,
      onApiReady,
      onDiffUpdated,
    };
  });

  React.useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const measuredNodes = measuredNodesRef.current;
    const mountedZones = mountedZonesRef.current;

    const stopThemeObserver = observeHostTheme((theme) =>
      monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs"),
    );

    const editor = createEditorHandle(containerRef.current, singleFile, singleFileSide);
    editorRef.current = editor;
    const sides = editorSides(editor);

    callbacksRef.current.onApiReady?.({
      goToDiff: (direction) => editor.goToDiff(direction),
    });

    // The count is only known once the worker has run, and again after every
    // model change, so it is reported rather than read on demand.
    const diffSubscription = editor.onDidUpdateDiff(() => {
      callbacksRef.current.onDiffUpdated?.(editor.differenceCount());
      applyPendingReveal();
    });

    const observer = new ResizeObserver((entries) => {
      let resized = false;
      for (const entry of entries) {
        const mounted = measuredNodesRef.current.get(entry.target);
        if (!mounted) {
          continue;
        }

        // A measurement of 0 means the zone is not rendered right now; keeping
        // the previous height avoids collapsing it into an unrecoverable state.
        const height = Math.ceil((entry.target as HTMLElement).offsetHeight);
        if (height <= 0 || height === mounted.height) {
          continue;
        }

        mounted.height = height;
        mounted.zone.heightInPx = height;
        resized = true;
        editor.sideEditor(mounted.side).changeViewZones((accessor) =>
          accessor.layoutZone(mounted.zoneId),
        );
      }

      if (resized) {
        applyPendingReveal();
      }
    });
    observerRef.current = observer;

    const glyphMarginLine = (event: monaco.editor.IEditorMouseEvent): number | undefined =>
      event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ? event.target.position?.lineNumber
        : undefined;

    /** Any line under the pointer, code or margin: the affordance follows the row. */
    const hoveredLine = (event: monaco.editor.IEditorMouseEvent): number | undefined =>
      event.target.position?.lineNumber;

    const handleGlyphClick = (
      side: DiffSideKey,
      event: monaco.editor.IEditorMouseEvent,
    ): void => {
      const line = glyphMarginLine(event);
      if (line === undefined) {
        return;
      }

      const threadId = commentedLinesRef.current[side].get(line);
      if (threadId !== undefined) {
        callbacksRef.current.onSelectThread?.(threadId);
        return;
      }

      const model = editor.sideEditor(side).getModel();
      callbacksRef.current.onRequestComment?.({
        side,
        startLine: line,
        startOffset: 1,
        endLine: line,
        endOffset: (model?.getLineLength(line) ?? 0) + 1,
      });
    };

    // A single decoration marks where a comment can be added, so every line
    // offers the affordance without paying for one decoration per line. It
    // follows the pointer down the glyph margin, and stays pinned to the last
    // line of a selection so selected code always has a visible target.
    const hovered: Partial<Record<DiffSideKey, number>> = {};
    const pinned: Partial<Record<DiffSideKey, number>> = {};
    // Now that the pointer is tracked over the whole editor and not just the
    // margin, the decoration is only rewritten when the line actually changes.
    const shown: Partial<Record<DiffSideKey, number>> = {};

    const refreshAddAffordance = (side: DiffSideKey): void => {
      const line = hovered[side] ?? pinned[side];
      if (line === shown[side]) {
        return;
      }

      shown[side] = line;
      const target =
        line !== undefined && !commentedLinesRef.current[side].has(line)
          ? [createAddCommentDecoration(line)]
          : [];
      const collection = hoverCollectionsRef.current[side];
      if (collection) {
        collection.set(target);
        return;
      }

      hoverCollectionsRef.current[side] = editor
        .sideEditor(side)
        .createDecorationsCollection(target);
    };

    const pinZones = (side: DiffSideKey): void => {
      const codeEditor = editor.sideEditor(side);
      for (const mounted of mountedZonesRef.current.values()) {
        if (mounted.side === side) {
          pinZoneToViewport(codeEditor, mounted.container);
        }
      }
    };

    const subscriptions = sides.flatMap((side) => {
      const codeEditor = editor.sideEditor(side);
      return [
        codeEditor.onDidScrollChange((event) => {
          if (event.scrollLeftChanged || event.scrollWidthChanged) {
            pinZones(side);
          }
        }),
        // The content area changes width on a window resize, on the splitter
        // being dragged, and on the switch between unified and side by side.
        codeEditor.onDidLayoutChange(() => pinZones(side)),
        codeEditor.onDidChangeCursorSelection((event) => {
          const selection = mapSelection(side, event.selection);
          callbacksRef.current.onSelectionChange?.(selection);
          pinned[side] = selection?.endLine;
          refreshAddAffordance(side);
        }),
        codeEditor.onMouseDown((event) => handleGlyphClick(side, event)),
        codeEditor.onMouseMove((event) => {
          hovered[side] = hoveredLine(event);
          refreshAddAffordance(side);
        }),
        codeEditor.onMouseLeave(() => {
          hovered[side] = undefined;
          refreshAddAffordance(side);
        }),
      ];
    });

    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      diffSubscription?.dispose();
      callbacksRef.current.onApiReady?.(undefined);
      stopThemeObserver();
      Object.values(hoverCollectionsRef.current).forEach((collection) => collection?.clear());
      hoverCollectionsRef.current = {};
      observer.disconnect();
      observerRef.current = undefined;
      measuredNodes.clear();
      mountedZones.forEach((mounted) => mounted.dispose());
      mountedZones.clear();
      decorationCollectionsRef.current.forEach((collection) => collection.clear());
      decorationCollectionsRef.current = [];
      editorRef.current = undefined;
      editor.dispose();
    };
  }, [applyPendingReveal, singleFile, singleFileSide]);

  React.useEffect(() => {
    editorRef.current?.setSideBySide(renderSideBySide);
  }, [renderSideBySide]);

  // Re-applied on the layout as well as on the switch, because of the override
  // below: nothing else puts it back when the two sides come apart.
  React.useEffect(() => {
    const editor = editorRef.current;
    editor?.setTextOptions({ wordWrap: wordWrap ? "on" : "off" });

    // While the diff is inline Monaco forces `wordWrapOverride2: "off"` on the
    // original editor — "never wrap hidden editor" — and does not clear it when
    // side by side brings that editor back. The override outranks `wordWrap`,
    // so the left column was the one pane that ignored the switch.
    editor
      ?.sideEditor("left")
      .updateOptions({ wordWrapOverride2: renderSideBySide ? "inherit" : "off" });
  }, [renderSideBySide, wordWrap]);

  // Two settings, one switch: the glyphs make whitespace visible, and the diff
  // option makes it count. Showing marks on a line the comparison has decided
  // is unchanged would be the worse half of the answer on its own.
  React.useEffect(() => {
    const editor = editorRef.current;
    editor?.setTextOptions({ renderWhitespace: showWhitespace ? "all" : "selection" });
    editor?.setWhitespaceInDiff(showWhitespace);
  }, [showWhitespace]);

  React.useEffect(() => {
    const editor = editorRef.current;
    editor?.setTextOptions({ stickyScroll: { enabled: stickyScroll } });
  }, [stickyScroll]);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    modelsRef.current.forEach((model) => model.dispose());
    const encodedPath = encodeURIComponent(filePath);
    const modifiedModel = monaco.editor.createModel(
      modified,
      language,
      monaco.Uri.parse(`inmemory://advanced-pr/modified/${encodedPath}`),
    );
    // Created for the diff, and for a single editor showing the base side.
    const originalModel =
      editor.kind === "diff" || editor.side === "left"
        ? monaco.editor.createModel(
            original,
            language,
            monaco.Uri.parse(`inmemory://advanced-pr/original/${encodedPath}`),
          )
        : undefined;
    modelsRef.current = originalModel ? [originalModel, modifiedModel] : [modifiedModel];
    editor.setModels({ original: originalModel, modified: modifiedModel });

    return () => {
      if (editorRef.current === editor) {
        editor.clearModels();
      }
      modelsRef.current.forEach((model) => model.dispose());
      modelsRef.current = [];
    };
  }, [filePath, language, modified, original]);

  React.useEffect(() => {
    const editor = editorRef.current;
    const observer = observerRef.current;
    if (!editor || !observer) {
      return;
    }

    const mounted = mountedZonesRef.current;
    const desired = new Map(zones.map((anchor) => [anchor.key, anchor]));
    let changed = false;

    for (const [key, zone] of [...mounted]) {
      const anchor = desired.get(key);
      if (!anchor) {
        zone.dispose();
        measuredNodesRef.current.delete(zone.content);
        mounted.delete(key);
        changed = true;
      } else if (anchor.side !== zone.side || anchor.afterLineNumber !== zone.afterLineNumber) {
        relocateZone(editor, zone, anchor);
      }
    }

    for (const anchor of zones) {
      if (mounted.has(anchor.key)) {
        continue;
      }

      const zone = createZone(editor, anchor);
      observer.observe(zone.content);
      measuredNodesRef.current.set(zone.content, zone);
      mounted.set(anchor.key, zone);
      changed = true;
    }

    if (changed) {
      setZoneNodes(new Map([...mounted].map(([key, zone]) => [key, zone.content])));
    }
  }, [zones]);

  React.useEffect(() => {
    if (!revealTarget) {
      pendingRevealRef.current = undefined;
      return;
    }

    pendingRevealRef.current = { target: revealTarget, until: Date.now() + revealSettleWindow };
    applyPendingReveal();
  }, [applyPendingReveal, revealTarget]);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const sides = editorSides(editor);
    const bySide = new Map(
      sides.map((side) => [side, threadDecorations.filter((thread) => thread.side === side)]),
    );
    commentedLinesRef.current = {
      left: new Map((bySide.get("left") ?? []).map((thread) => [thread.line, thread.id])),
      right: new Map((bySide.get("right") ?? []).map((thread) => [thread.line, thread.id])),
    };

    decorationCollectionsRef.current.forEach((collection) => collection.clear());
    decorationCollectionsRef.current = sides.map((side) =>
      editor
        .sideEditor(side)
        .createDecorationsCollection(
          createThreadDecorations(bySide.get(side) ?? [], selectedThreadId),
        ),
    );

    return () => {
      decorationCollectionsRef.current.forEach((collection) => collection.clear());
      decorationCollectionsRef.current = [];
    };
  }, [filePath, selectedThreadId, threadDecorations]);

  const anchorsByKey = new Map(zones.map((anchor) => [anchor.key, anchor]));

  return (
    <div ref={containerRef} className="diff-editor" aria-label={`Diff for ${filePath}`}>
      {renderZone &&
        [...zoneNodes].map(([key, node]) => {
          const anchor = anchorsByKey.get(key);
          return anchor ? ReactDOM.createPortal(renderZone(anchor), node, key) : null;
        })}
    </div>
  );
}

/**
 * Keeps a zone inside the visible part of the editor. A view zone is a child of
 * `.lines-content`, which is as wide as the longest line in the file and is
 * offset by `left: -scrollLeft`: left alone, the comment is laid out against
 * that width and slides away with the code, so reading it means scrolling
 * sideways. Sized to the content area and moved back by the scroll offset, it
 * always fits and always stays put.
 */
function pinZoneToViewport(codeEditor: monaco.editor.ICodeEditor, container: HTMLElement): void {
  const { contentWidth } = codeEditor.getLayoutInfo();
  // Zero while the editor has no width of its own yet, and a zone zero pixels
  // wide would be measured as empty and stay collapsed; the layout change that
  // gives the editor its width pins it again.
  container.style.width = contentWidth > 0 ? `${contentWidth}px` : "100%";
  container.style.transform = `translateX(${codeEditor.getScrollLeft()}px)`;
}

/** Anything a tap is meant to reach: it must not be turned into an editor tap. */
const zoneControlSelector = "a, button, input, textarea, select, [contenteditable='true']";

function stopTouchOnControls(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(zoneControlSelector)) {
    event.stopPropagation();
  }
}

function createZone(editor: EditorHandle, anchor: DiffZoneAnchor): MountedZone {
  const container = document.createElement("div");
  container.className = "advanced-pr-zone";
  const content = document.createElement("div");
  content.className = "advanced-pr-zone-content";
  container.appendChild(content);

  // The zone lives inside the editor's DOM, so Monaco's keybinding service sees
  // every keystroke typed in a reply box (arrows move the cursor, Ctrl+F opens
  // the find widget). Stopping the native key events here shields the editor.
  // Consequence: React's document-level delegation never sees them either, so
  // components rendered inside a zone must not rely on React key handlers.
  const stopKeys = (event: Event): void => event.stopPropagation();
  container.addEventListener("keydown", stopKeys);
  container.addEventListener("keyup", stopKeys);
  container.addEventListener("keypress", stopKeys);

  // The same problem under a finger, and worse. Monaco's gesture recogniser
  // listens on the document, and its tap handler calls `preventDefault` and
  // pulls focus to the editor's own textarea: a tap on a button inside a zone
  // never becomes a click, and a tap on a reply box never gets to keep the
  // focus it needs to receive typing. Only touches that start on a control are
  // withheld from it, so dragging anywhere else over a comment still scrolls
  // the diff, which is most of what a finger does here.
  container.addEventListener("touchstart", stopTouchOnControls, { passive: true });
  container.addEventListener("touchmove", stopTouchOnControls, { passive: true });
  container.addEventListener("touchend", stopTouchOnControls);

  const zone: monaco.editor.IViewZone = {
    afterLineNumber: anchor.afterLineNumber,
    heightInPx: provisionalZoneHeight,
    domNode: container,
    // Must stay false despite the name: when set, Monaco preventDefaults the
    // mouse down, pulls focus to its own textarea and starts a drag selection,
    // so buttons and inputs inside the zone never receive the interaction.
    suppressMouseDown: false,
  };

  let zoneId = "";
  editor.sideEditor(anchor.side).changeViewZones((accessor) => {
    zoneId = accessor.addZone(zone);
  });
  // Before Monaco lays it out: a zone created while the code is scrolled
  // sideways would otherwise appear off screen for one frame.
  pinZoneToViewport(editor.sideEditor(anchor.side), container);

  const mounted: MountedZone = {
    key: anchor.key,
    zoneId,
    side: anchor.side,
    afterLineNumber: anchor.afterLineNumber,
    container,
    content,
    zone,
    height: provisionalZoneHeight,
    dispose: () => {
      container.removeEventListener("keydown", stopKeys);
      container.removeEventListener("keyup", stopKeys);
      container.removeEventListener("keypress", stopKeys);
      container.removeEventListener("touchstart", stopTouchOnControls);
      container.removeEventListener("touchmove", stopTouchOnControls);
      container.removeEventListener("touchend", stopTouchOnControls);
      editor.sideEditor(mounted.side).changeViewZones((accessor) =>
        accessor.removeZone(mounted.zoneId),
      );
    },
  };

  return mounted;
}

/**
 * Moves a zone to a new line or to the other side of the diff while keeping the
 * same DOM nodes, so the portal, and the React state inside it, survives.
 */
function relocateZone(
  editor: EditorHandle,
  mounted: MountedZone,
  anchor: DiffZoneAnchor,
): void {
  if (anchor.side === mounted.side) {
    mounted.zone.afterLineNumber = anchor.afterLineNumber;
    mounted.afterLineNumber = anchor.afterLineNumber;
    editor.sideEditor(mounted.side).changeViewZones((accessor) =>
      accessor.layoutZone(mounted.zoneId),
    );
    return;
  }

  editor.sideEditor(mounted.side).changeViewZones((accessor) =>
    accessor.removeZone(mounted.zoneId),
  );
  mounted.zone.afterLineNumber = anchor.afterLineNumber;
  mounted.afterLineNumber = anchor.afterLineNumber;
  mounted.side = anchor.side;
  editor.sideEditor(anchor.side).changeViewZones((accessor) => {
    mounted.zoneId = accessor.addZone(mounted.zone);
  });
  // The other side scrolls and lays out on its own, so the pin is not the one
  // this zone was carrying.
  pinZoneToViewport(editor.sideEditor(anchor.side), mounted.container);
}

function createEditorHandle(
  container: HTMLElement,
  singleFile: boolean,
  singleFileSide: DiffSideKey,
): EditorHandle {
  const shared = {
    automaticLayout: true,
    glyphMargin: true,
    readOnly: true,
    // Puts `readonly` on the hidden textarea Monaco keeps the focus in. Nothing
    // was ever editable, but a plain focus on a writable field is what raises
    // the software keyboard: tapping the code brought it up over half the screen
    // for text that cannot be typed into. Selection and copying are unaffected.
    domReadOnly: true,
    // And `domReadOnly` only reaches that textarea. Left to itself Monaco now
    // prefers the EditContext API, whose input surface is a focusable element
    // the browser treats as an editor whatever the editor's own read-only flag
    // says, so the keyboard came up anyway. The textarea implementation is the
    // one that can be told there is nothing to type, and this viewer never
    // types: no composition, no IME, nothing the newer path is there for.
    editContext: false,
    scrollBeyondLastLine: false,
  };

  if (singleFile) {
    const editor = monaco.editor.create(container, shared);
    return {
      kind: "single",
      side: singleFileSide,
      // A file shown on one side alone has nothing to navigate between.
      goToDiff: () => undefined,
      differenceCount: () => 0,
      onDidUpdateDiff: () => undefined,
      sideEditor: () => editor,
      setModels: ({ original, modified }) =>
        editor.setModel(singleFileSide === "left" ? (original ?? modified) : modified),
      clearModels: () => editor.setModel(null),
      setSideBySide: () => undefined,
      setTextOptions: (options) => editor.updateOptions(options),
      // Nothing is being compared, so there is no comparison to tune.
      setWhitespaceInDiff: () => undefined,
      dispose: () => editor.dispose(),
    };
  }

  const editor = monaco.editor.createDiffEditor(container, {
    ...shared,
    enableSplitViewResizing: true,
  });
  return {
    kind: "diff",
    side: "right",
    goToDiff: (direction) => editor.goToDiff(direction),
    differenceCount: () => editor.getLineChanges()?.length ?? 0,
    onDidUpdateDiff: (callback) => editor.onDidUpdateDiff(callback),
    sideEditor: (side) =>
      side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor(),
    setModels: ({ original, modified }) =>
      original && editor.setModel({ original, modified }),
    clearModels: () => editor.setModel(null),
    setSideBySide: (value) => editor.updateOptions({ renderSideBySide: value }),
    setTextOptions: (options) => editor.updateOptions(options),
    setWhitespaceInDiff: (value) => editor.updateOptions({ ignoreTrimWhitespace: !value }),
    dispose: () => editor.dispose(),
  };
}

/** A single editor has one side only; wiring "left" to it would duplicate work. */
function editorSides(editor: EditorHandle): readonly DiffSideKey[] {
  return editor.kind === "single" ? [editor.side] : ["left", "right"];
}

function createAddCommentDecoration(line: number): monaco.editor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(line, 1, line, 1),
    options: {
      glyphMarginClassName: "guided-review-add-comment-glyph",
      glyphMarginHoverMessage: { value: "Add a comment on this line" },
    },
  };
}

function createThreadDecorations(
  threads: readonly DiffThreadDecoration[],
  selectedThreadId: number | undefined,
): monaco.editor.IModelDeltaDecoration[] {
  return threads.map((thread) => ({
    range: new monaco.Range(thread.line, 1, thread.line, 1),
    options: {
      isWholeLine: true,
      className: thread.id === selectedThreadId ? "guided-review-thread-line-selected" : undefined,
      glyphMarginClassName: thread.isOpen
        ? "guided-review-thread-glyph-open"
        : "guided-review-thread-glyph-resolved",
      glyphMarginHoverMessage: {
        value: thread.isOpen ? "Open review comment" : "Resolved review comment",
      },
    },
  }));
}

function mapSelection(side: "left" | "right", selection: monaco.Selection): DiffSelection | undefined {
  if (selection.isEmpty()) {
    return undefined;
  }

  return {
    side,
    startLine: selection.startLineNumber,
    startOffset: selection.startColumn,
    endLine: selection.endLineNumber,
    endOffset: selection.endColumn,
  };
}
