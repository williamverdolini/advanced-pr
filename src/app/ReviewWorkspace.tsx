import * as React from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { Card } from "azure-devops-ui/Card";
import { Dialog } from "azure-devops-ui/Dialog";
import { TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner } from "azure-devops-ui/Spinner";
import {
  Splitter,
  SplitterDirection,
  SplitterElementPosition,
} from "azure-devops-ui/Splitter";
import {
  DiffViewer,
  type DiffSelection,
  type DiffViewerApi,
} from "../components/DiffViewer";
import { FileTree } from "../components/FileTree";
import { Markdown } from "../components/Markdown";
import { MentionContext } from "../components/mentionContext";
import { contentSideForChange, isContentOnlyChange } from "../core/changeType";
import { nextFileToReview } from "../core/fileTree";
import type { InlineZoneDescriptor } from "../core/inlineZones";
import type { ReviewStep } from "../core/reviewPlan";
import { maxSplitterWidth, minSplitterWidth } from "../core/splitterWidth";
import { indexThreadsByFile } from "../core/threadIndex";
import {
  createAnchoredThread,
  loadChangedFileDiff,
  type ChangedFile,
  type PullRequestWorkspace,
  type ReviewThread,
} from "../platform/azureDevOpsClient";
import { loadSplitterWidth, saveSplitterWidth } from "../platform/splitterWidthStore";
import { buildDiffCommands } from "./diffCommands";
import { ExplainPanel } from "./ExplainPanel";
import { InlineComposer } from "./InlineComposer";
import { InlineThreadCard } from "./InlineThreadCard";
import { PlanEditor } from "./PlanEditor";
import { createPlanTemplate } from "./planTemplate";
import { SignOffDialog } from "./SignOffDialog";
import { StepActions } from "./StepActions";
import { StepWizard } from "./StepWizard";
import { useAsyncResource } from "./useAsyncResource";
import { useCollapsedThreads } from "./useCollapsedThreads";
import { useDiffSelection } from "./useDiffSelection";
import { useHostPathSync } from "./useHostPathSync";
import { useInlineDiff } from "./useInlineDiff";
import { useMentionDirectory } from "./useMentionDirectory";
import { useReviewState } from "./useReviewState";
import { useViewedFiles } from "./useViewedFiles";

export interface ReviewWorkspaceProps {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  onRefresh: () => Promise<unknown>;
}

/**
 * The review itself: the step wizard, the file tree and the diff, with the state
 * tying them together. Each self-contained concern lives in its own hook, so
 * what is left here is the wiring between them.
 */
export function ReviewWorkspace({
  workspace,
  reviewerId,
  onRefresh,
}: ReviewWorkspaceProps): React.ReactElement {
  const [selectedFile, setSelectedFile] = React.useState<ChangedFile>();
  const [selectedStepId, setSelectedStepId] = React.useState(
    workspace.plan.steps.find((step) => step.files.length > 0)?.stepId,
  );
  const [selectedThreadId, setSelectedThreadId] = React.useState<number>();
  const [sideBySide, setSideBySide] = React.useState(false);
  const [draft, setDraft] = React.useState<DiffSelection>();
  const [explainExpanded, setExplainExpanded] = React.useState(false);
  const [planEditorOpen, setPlanEditorOpen] = React.useState(false);
  const [planDraft, setPlanDraft] = React.useState(() => createPlanTemplate(workspace));
  // Read once, on mount: the Splitter owns its width from there on, and feeding
  // it back a value it already applied would fight the drag in progress.
  const [initialSplitterWidth] = React.useState(loadSplitterWidth);

  const resolveMention = useMentionDirectory(workspace);
  const collapsed = useCollapsedThreads();
  const selection = useDiffSelection();
  const review = useReviewState({
    workspace,
    reviewerId,
    planDraft,
    onRefresh,
    // `selectStep` is declared further down; the closure only runs once a
    // decision has been recorded, long after this render assigned it.
    onAdvanceToStep: (step) => selectStep(step),
    onPlanCreated: () => setPlanEditorOpen(false),
  });

  const selectedStep = workspace.plan.steps.find((step) => step.stepId === selectedStepId);
  const selectedStepStatus = selectedStep
    ? review.reviewerSteps?.get(selectedStep.stepId)
    : undefined;

  // A file that exists on one side only is shown as plain content, so there are
  // no sides to lay out and the one side it has is the one on screen.
  const contentOnly = selectedFile ? isContentOnlyChange(selectedFile.changeKind) : false;
  const contentSide = selectedFile ? contentSideForChange(selectedFile.changeKind) : "right";
  const splitView = sideBySide && !contentOnly;

  // Memoized only where identity matters: each of these feeds a dependency
  // array, another memo, or a component that would otherwise rebuild. The plain
  // `const`s above are recomputed on every render, which costs less than the
  // bookkeeping would.
  const blobSource = React.useMemo(
    () => ({ repositoryId: workspace.repositoryId, projectId: workspace.projectId }),
    [workspace.repositoryId, workspace.projectId],
  );
  const viewedScope = React.useMemo(
    () => ({
      id: workspace.id,
      repositoryId: workspace.repositoryId,
      projectId: workspace.projectId,
      files: workspace.files,
    }),
    [workspace.files, workspace.id, workspace.projectId, workspace.repositoryId],
  );
  const threadsByFile = React.useMemo(
    () => indexThreadsByFile(workspace.threads),
    [workspace.threads],
  );
  const visibleFiles = React.useMemo(
    () =>
      selectedStep
        ? workspace.files.filter((file) => selectedStep.files.includes(file.path))
        : workspace.files,
    [selectedStep, workspace.files],
  );
  const fileThreads = React.useMemo(
    () => (selectedFile ? threadsByFile.get(selectedFile.path) ?? [] : []),
    [selectedFile, threadsByFile],
  );
  const threadsById = React.useMemo(
    () => new Map(fileThreads.map((thread) => [thread.id, thread])),
    [fileThreads],
  );
  const inlineDiff = useInlineDiff({
    filePath: selectedFile?.path,
    threads: fileThreads,
    draft,
    selectedThreadId,
    collapsedThreadIds: collapsed.collapsedThreadIds,
    contentOnly,
    contentSide,
    splitView,
  });

  const { viewedFiles, setFilesViewed } = useViewedFiles(viewedScope);
  const visibleViewedCount = visibleFiles.filter((file) => viewedFiles.has(file.path)).length;

  const loadDiff = React.useMemo(
    () => (selectedFile ? () => loadChangedFileDiff(blobSource, selectedFile) : undefined),
    [blobSource, selectedFile],
  );
  const {
    data: diff,
    error: diffError,
    loading: diffLoading,
  } = useAsyncResource(loadDiff, "Unable to load this file.");

  useHostPathSync({
    files: workspace.files,
    steps: workspace.plan.steps,
    selectedFile,
    onRestore: (file, step) => {
      if (step) {
        setSelectedStepId(step.stepId);
      }
      setSelectedFile(file);
    },
  });

  const selectStep = (step: ReviewStep): void => {
    setSelectedStepId(step.stepId);
    setSelectedThreadId(undefined);
    setDraft(undefined);
    setSelectedFile(
      nextFileToReview(
        workspace.files.filter((file) => step.files.includes(file.path)),
        viewedFiles,
      ),
    );
  };

  const diffApiRef = React.useRef<DiffViewerApi>();
  // Reported by Monaco once it has compared the two sides, and reset per file
  // so the arrows are never enabled against a diff that is not there yet.
  const [differenceCount, setDifferenceCount] = React.useState(0);

  React.useEffect(() => {
    setDifferenceCount(0);
  }, [selectedFile]);

  // The callbacks below are memoized because they are passed to `FileTree` and
  // `DiffViewer`, where a new function identity on every render would rebuild
  // decorations and view zones. Handlers wired to a plain button are not.
  const selectFile = React.useCallback(
    (file: ChangedFile): void => {
      setSelectedFile(file);
      setSelectedThreadId(undefined);
      setDraft(undefined);
      selection.clear();
    },
    [selection],
  );

  // Reaching a thread from the tree must always show it, even if its glyph was
  // used to collapse it earlier.
  const selectThread = React.useCallback(
    (file: ChangedFile, thread: ReviewThread): void => {
      setSelectedFile(file);
      setSelectedThreadId(thread.id);
      collapsed.setCollapsed(thread.id, false);
    },
    [collapsed],
  );

  const toggleThreadFromGlyph = React.useCallback(
    (threadId: number): void => {
      collapsed.toggle(threadId);
      setSelectedThreadId(threadId);
    },
    [collapsed],
  );

  const requestComment = React.useCallback(
    (line: DiffSelection): void => {
      setDraft(selection.anchorFor(line));
      setSelectedThreadId(undefined);
    },
    [selection],
  );

  const submitDraft = async (content: string): Promise<void> => {
    if (!selectedFile || !draft) {
      return;
    }

    await createAnchoredThread(workspace, selectedFile, draft, content);
    setDraft(undefined);
    await onRefresh();
  };

  const renderZone = (zone: InlineZoneDescriptor): React.ReactNode => {
    if (zone.kind === "draft") {
      return (
        <InlineComposer
          anchor={draft}
          onCancel={() => setDraft(undefined)}
          onSubmit={submitDraft}
        />
      );
    }

    const threads = zone.threadIds
      .map((threadId) => threadsById.get(threadId))
      .filter((thread): thread is ReviewThread => Boolean(thread));

    return (
      <div className={zone.kind === "orphans" ? "inline-zone-stack orphans" : "inline-zone-stack"}>
        {zone.kind === "orphans" && (
          <p className="inline-zone-caption">
            {splitView
              ? "Comments without a line anchor in this iteration"
              : "Comments anchored to a side that is not shown, or without a line anchor"}
          </p>
        )}
        {threads.map((thread) => (
          <InlineThreadCard
            key={thread.id}
            workspace={workspace}
            thread={thread}
            reviewerId={reviewerId}
            selected={selectedThreadId === thread.id}
            onSelect={setSelectedThreadId}
            onCollapse={() => collapsed.setCollapsed(thread.id, true)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    );
  };

  return (
    <MentionContext.Provider value={resolveMention}>
      <section className="workspace-shell">
        {/* Title, branches and counters live in the Azure DevOps header that
            embeds this iframe: repeating them here would only cost height. */}
        <header className="review-header">
          <div className="review-toolbar">
            <StepWizard
              steps={review.displayedSteps}
              selectedStepId={selectedStep?.stepId}
              statuses={review.reviewerSteps}
              decisions={review.stepDecisions}
              reviewerId={reviewerId}
              viewedFiles={viewedFiles}
              onSelect={selectStep}
            />
            <StepActions
              step={selectedStep}
              status={selectedStepStatus}
              pending={review.pending}
              reviewClosed={review.reviewClosed}
              isAuthor={reviewerId === workspace.authorId}
              planExists={Boolean(workspace.plan.sourceThreadId)}
              onDecision={review.decideStep}
              onTogglePlanEditor={() => setPlanEditorOpen((open) => !open)}
            />
          </div>
          {planEditorOpen && reviewerId === workspace.authorId && (
            <PlanEditor
              value={planDraft}
              isNewPlan={!workspace.plan.sourceThreadId}
              pending={review.pending}
              reviewClosed={review.reviewClosed}
              onChange={setPlanDraft}
              onSave={review.createPlan}
              onCancel={() => setPlanEditorOpen(false)}
            />
          )}
          {review.reviewClosed && (
            <MessageCard severity={MessageCardSeverity.Info}>
              This pull request is {workspace.state}. Review actions are disabled; comments stay
              readable.
            </MessageCard>
          )}
          {!workspace.plan.sourceThreadId && reviewerId !== workspace.authorId && (
            <MessageCard severity={MessageCardSeverity.Info}>
              The pull request author must create the plan before step decisions can be recorded.
            </MessageCard>
          )}
        </header>
        {review.error && (
          <MessageCard severity={MessageCardSeverity.Error}>{review.error}</MessageCard>
        )}
        <Splitter
          className="review-workspace"
          ariaLabel="Files splitter"
          splitterDirection={SplitterDirection.Vertical}
          fixedElement={SplitterElementPosition.Near}
          initialFixedSize={initialSplitterWidth}
          minFixedSize={minSplitterWidth}
          maxFixedSize={maxSplitterWidth}
          onFixedSizeChanged={saveSplitterWidth}
          nearElementClassName="workspace-pane"
          farElementClassName="workspace-pane"
          onRenderNearElement={() => (
            <div className="files-column">
              {selectedStep?.explanation && (
                <ExplainPanel
                  stepTitle={selectedStep.title}
                  explanation={selectedStep.explanation}
                  onExpand={() => setExplainExpanded(true)}
                />
              )}
              <Card
                className="files-pane"
                titleProps={{
                  text: `Changed files (${visibleViewedCount}/${visibleFiles.length})`,
                  size: TitleSize.Medium,
                }}
              >
                <FileTree
                  key={selectedStep?.stepId ?? "all-files"}
                  files={visibleFiles}
                  viewedFiles={viewedFiles}
                  selectedFile={selectedFile}
                  selectedThreadId={selectedThreadId}
                  threadsByFile={threadsByFile}
                  onSelectFile={selectFile}
                  onSelectThread={selectThread}
                  onSetViewed={setFilesViewed}
                />
              </Card>
            </div>
          )}
          onRenderFarElement={() => (
            <Card
              className="diff-pane"
              // Name on the title line, folder underneath: the full path of a
              // deeply nested file would push the commands off the header.
              titleProps={{
                text: selectedFile ? fileName(selectedFile.path) : "Diff",
                size: TitleSize.Small,
                className: "diff-title",
              }}
              headerDescriptionProps={
                selectedFile
                  ? { text: selectedFile.path, className: "diff-title-path" }
                  : undefined
              }
              headerCommandBarItems={
                selectedFile
                  ? buildDiffCommands({
                      contentOnly,
                      contentSide,
                      sideBySide,
                      differenceCount,
                      onSideBySideChange: setSideBySide,
                      onGoToDifference: (direction) =>
                        diffApiRef.current?.goToDiff(direction),
                    })
                  : undefined
              }
            >
              {!selectedFile && <p className="empty-pane">Select a file to view its diff.</p>}
              {diffLoading && <Spinner label="Loading file" />}
              {diffError && (
                <MessageCard severity={MessageCardSeverity.Warning}>{diffError}</MessageCard>
              )}
              {inlineDiff.hiddenThreadCount > 0 && (
                <MessageCard severity={MessageCardSeverity.Info}>
                  {inlineDiff.hiddenThreadCount} more comments on this file are listed in the tree
                  but not shown inline.
                </MessageCard>
              )}
              {selectedFile && diff && (
                <DiffViewer
                  original={diff.original}
                  modified={diff.modified}
                  language={diff.language}
                  filePath={selectedFile.path}
                  zones={inlineDiff.zones}
                  renderZone={renderZone}
                  renderSideBySide={splitView}
                  singleFile={contentOnly}
                  singleFileSide={contentSide}
                  threadDecorations={inlineDiff.threadDecorations}
                  selectedThreadId={selectedThreadId}
                  revealTarget={inlineDiff.revealTarget}
                  onSelectionChange={selection.track}
                  onSelectThread={toggleThreadFromGlyph}
                  onRequestComment={requestComment}
                  apiRef={diffApiRef}
                  onDiffUpdated={setDifferenceCount}
                />
              )}
            </Card>
          )}
        />
        {explainExpanded && selectedStep?.explanation && (
          <Dialog
            titleProps={{ text: `Explain: ${selectedStep.title}` }}
            // The point of the dialog is room to read: 800px, narrowing to 80% of
            // the viewport below 1024px.
            contentSize={ContentSize.ExtraLarge}
            onDismiss={() => setExplainExpanded(false)}
            footerButtonProps={[
              { text: "Close", primary: true, onClick: () => setExplainExpanded(false) },
            ]}
          >
            <Markdown className="explain-dialog-body" content={selectedStep.explanation} />
          </Dialog>
        )}
        {review.signOffOpen && (
          <SignOffDialog
            workspace={workspace}
            reviewerId={reviewerId}
            currentVote={review.currentReviewerVote}
            pending={review.pending}
            onDismiss={() => review.setSignOffOpen(false)}
            onConfirm={review.approvePullRequest}
          />
        )}
        {workspace.plan.warnings.length > 0 && (
          <MessageCard severity={MessageCardSeverity.Warning}>
            {workspace.plan.warnings.map((warning) => warning.message).join(" ")}
          </MessageCard>
        )}
      </section>
    </MentionContext.Provider>
  );
}

/** The last segment of a repository path. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
