import * as React from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { Card } from "azure-devops-ui/Card";
import { Button } from "azure-devops-ui/Button";
import { Dialog } from "azure-devops-ui/Dialog";
import { TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Panel } from "azure-devops-ui/Panel";
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
import { AttachmentContext } from "../components/attachmentContext";
import { MentionContext } from "../components/mentionContext";
import { contentSideForChange, isContentOnlyChange } from "../core/changeType";
import { adjacentFile, fileNameFromPath, nextFileToReview } from "../core/fileTree";
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
import { ClearFeedbackDialog } from "./ClearFeedbackDialog";
import { ExplainPanel } from "./ExplainPanel";
import { InlineComposer } from "./InlineComposer";
import { InlineThreadCard } from "./InlineThreadCard";
import { PlanEditor } from "./PlanEditor";
import { createPlanTemplate } from "./planTemplate";
import { SignOffDialog } from "./SignOffDialog";
import { StepSelector } from "./StepSelector";
import { StepActions, type FeedbackScope } from "./StepActions";
import { StepWizard } from "./StepWizard";
import { useAsyncResource } from "./useAsyncResource";
import { useCollapsedThreads } from "./useCollapsedThreads";
import { useCommentAttachments } from "./useCommentAttachments";
import { useDiffSelection } from "./useDiffSelection";
import { useHostFullScreen } from "./useHostFullScreen";
import { useHostLocationSync } from "./useHostLocationSync";
import { useInlineDiff } from "./useInlineDiff";
import { useMentionDirectory } from "./useMentionDirectory";
import { useReviewState } from "./useReviewState";
import { useViewedFiles } from "./useViewedFiles";
import { useViewport } from "./useViewport";

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
  // What a share link pointed at, until the card has announced itself once.
  const [linked, setLinked] = React.useState<{ threadId: number; commentId?: number }>();
  const [sideBySide, setSideBySide] = React.useState(false);
  const [draft, setDraft] = React.useState<DiffSelection>();
  const [explainExpanded, setExplainExpanded] = React.useState(false);
  const [clearFeedbackScope, setClearFeedbackScope] = React.useState<FeedbackScope>();
  const [planEditorOpen, setPlanEditorOpen] = React.useState(false);
  const [planDraft, setPlanDraft] = React.useState(() => createPlanTemplate(workspace));
  const viewport = useViewport();
  const hostFullScreen = useHostFullScreen();
  // On a narrow screen the tree is a panel over the diff rather than a pane
  // beside it. It starts open because the alternative first screen is the empty
  // "Select a file", which on a phone is a dead end.
  const [filesOpen, setFilesOpen] = React.useState(viewport.narrow);
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
  // Two columns of code do not fit on a narrow screen, whatever the switch says,
  // and the switch itself is hidden there.
  const splitView = sideBySide && !contentOnly && !viewport.narrow;

  // Memoized only where identity matters: each of these feeds a dependency
  // array, another memo, or a component that would otherwise rebuild. The plain
  // `const`s above are recomputed on every render, which costs less than the
  // bookkeeping would.
  const blobSource = React.useMemo(
    () => ({ repositoryId: workspace.repositoryId, projectId: workspace.projectId }),
    [workspace.repositoryId, workspace.projectId],
  );
  const attachmentSource = React.useMemo(
    () => ({
      id: workspace.id,
      repositoryId: workspace.repositoryId,
      projectId: workspace.projectId,
    }),
    [workspace.id, workspace.projectId, workspace.repositoryId],
  );
  const attachments = useCommentAttachments(attachmentSource);
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
  // The plan names related files by path; the tree needs the changed file behind
  // each one, and only for the step on screen.
  const relatedFilesByPath = React.useMemo(() => {
    const byPath = new Map(workspace.files.map((file) => [file.path, file]));
    const links = new Map<string, readonly ChangedFile[]>();
    for (const [path, related] of selectedStep?.relatedFiles ?? []) {
      const files = related
        .map((relatedPath) => byPath.get(relatedPath))
        .filter((file): file is ChangedFile => Boolean(file));
      if (files.length > 0) {
        links.set(path, files);
      }
    }

    return links;
  }, [selectedStep, workspace.files]);
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
  const previousFile = adjacentFile(visibleFiles, selectedFile?.path, "previous");
  const nextFile = adjacentFile(visibleFiles, selectedFile?.path, "next");
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

  useHostLocationSync({
    files: workspace.files,
    steps: workspace.plan.steps,
    selectedFile,
    onRestore: ({ file, step, threadId, commentId }) => {
      if (step) {
        setSelectedStepId(step.stepId);
      }
      setSelectedFile(file);
      // Selecting it is what scrolls the diff to its line, once the file the
      // link named has loaded; the highlight is what says which comment of that
      // file the link was about.
      setSelectedThreadId(threadId);
      setLinked(threadId === undefined ? undefined : { threadId, commentId });
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

  // State rather than a ref: the toolbar that drives these commands is built
  // while rendering, and a ref must not be read there.
  const [diffApi, setDiffApi] = React.useState<DiffViewerApi>();
  const goToDifference = React.useCallback(
    (direction: "next" | "previous"): void => diffApi?.goToDiff(direction),
    [diffApi],
  );
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
      setFilesOpen(false);
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
      setFilesOpen(false);
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
            highlightedCommentId={
              // A link copied before the comment id was written into it still
              // points somewhere: the comment that opened the discussion.
              linked?.threadId === thread.id
                ? linked.commentId ?? thread.comments[0]?.id
                : undefined
            }
            onSelect={setSelectedThreadId}
            onHighlightShown={() => setLinked(undefined)}
            onCollapse={() => collapsed.setCollapsed(thread.id, true)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    );
  };

  const explainPanel = selectedStep?.explanation ? (
    <ExplainPanel
      stepTitle={selectedStep.title}
      explanation={selectedStep.explanation}
      onExpand={() => setExplainExpanded(true)}
    />
  ) : undefined;

  const fileTree = (
    <FileTree
      key={selectedStep?.stepId ?? "all-files"}
      files={visibleFiles}
      viewedFiles={viewedFiles}
      selectedFile={selectedFile}
      selectedThreadId={selectedThreadId}
      threadsByFile={threadsByFile}
      relatedFilesByPath={relatedFilesByPath}
      onSelectFile={selectFile}
      onSelectThread={selectThread}
      onSetViewed={setFilesViewed}
    />
  );

  const filesColumn = (
    <div className="files-column">
      {explainPanel}
      <Card
        className="files-pane"
        titleProps={{
          text: `Changed files (${visibleViewedCount}/${visibleFiles.length})`,
          size: TitleSize.Medium,
        }}
      >
        {fileTree}
      </Card>
    </div>
  );

  // The same content without the card around it: inside the panel the count is
  // already in the panel's own header, and a second title under it is noise.
  const filesDrawer = (
    <div className="files-drawer">
      {explainPanel}
      {fileTree}
    </div>
  );

  const renderDiffCard = (): React.ReactElement => (
    <Card
      className="diff-pane"
      // Name on the title line, folder underneath: the full path of a
      // deeply nested file would push the commands off the header.
      titleProps={{
        text: selectedFile ? fileNameFromPath(selectedFile.path) : "Diff",
        size: TitleSize.Small,
        // Struck through when the file is gone: it says the same as the line of
        // prose that used to sit in the command bar, in none of the width.
        className:
          selectedFile?.changeKind === "delete" ? "diff-title deleted" : "diff-title",
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
              sideBySide,
              // The layout switch is pointless where only one layout fits.
              layoutSwitch: !viewport.narrow,
              differenceCount,
              viewed: viewedFiles.has(selectedFile.path),
              onViewedChange: (viewed) => setFilesViewed([selectedFile.path], viewed),
              onSideBySideChange: setSideBySide,
              onGoToDifference: goToDifference,
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
      wordWrap={viewport.narrow}
          singleFile={contentOnly}
          singleFileSide={contentSide}
          threadDecorations={inlineDiff.threadDecorations}
          selectedThreadId={selectedThreadId}
          revealTarget={inlineDiff.revealTarget}
          onSelectionChange={selection.track}
          onSelectThread={toggleThreadFromGlyph}
          onRequestComment={requestComment}
          onApiReady={setDiffApi}
          onDiffUpdated={setDifferenceCount}
        />
      )}
    </Card>
  );

  return (
    <MentionContext.Provider value={resolveMention}>
      <AttachmentContext.Provider value={attachments}>
        <section className="workspace-shell">
          {/* Title, branches and counters live in the Azure DevOps header that
              embeds this iframe: repeating them here would only cost height. */}
          <header className="review-header">
            {/* Two rows on a narrow screen, one on a wide one, from the same
                markup: the steps take the width they can get, the commands stay
                together. */}
            <div className="review-toolbar">
              {/* The step and what to decide about it on one line, the controls
                  for looking at it on the next. Side by side while there is
                  width for both, stacked when there is not. */}
              <div className="toolbar-step">
                {viewport.narrow ? (
                  <StepSelector
                    steps={review.displayedSteps}
                    selectedStepId={selectedStep?.stepId}
                    statuses={review.reviewerSteps}
                    viewedFiles={viewedFiles}
                    onSelect={selectStep}
                  />
                ) : (
                  <StepWizard
                    steps={review.displayedSteps}
                    selectedStepId={selectedStep?.stepId}
                    statuses={review.reviewerSteps}
                    decisions={review.stepDecisions}
                    reviewerId={reviewerId}
                    viewedFiles={viewedFiles}
                    onSelect={selectStep}
                  />
                )}
                <StepActions
                  step={selectedStep}
                  status={selectedStepStatus}
                  pending={review.pending}
                  reviewClosed={review.reviewClosed}
                  isAuthor={reviewerId === workspace.authorId}
                  planExists={Boolean(workspace.plan.sourceThreadId)}
                  clearableFeedback={{
                    step: review.reviewersWithFeedback(selectedStep).length > 0,
                    all: review.reviewersWithFeedback().length > 0,
                  }}
                  onDecision={review.decideStep}
                  onTogglePlanEditor={() => setPlanEditorOpen((open) => !open)}
                  onRequestClearFeedback={setClearFeedbackScope}
                />
              </div>
              <div className="toolbar-view">
                {/* The host's full screen, not the browser's: it hides the pull
                    request chrome and hands this iframe the page. On a phone the
                    tab is a few hundred pixels tall, which is the difference
                    between reading a diff and not reading it. */}
                <Button
                  subtle
                  iconProps={{
                    iconName: hostFullScreen.fullScreen ? "BackToWindow" : "FullScreen",
                  }}
                  ariaLabel={hostFullScreen.fullScreen ? "Leave full screen" : "Go full screen"}
                  tooltipProps={{
                    text: hostFullScreen.fullScreen ? "Leave full screen" : "Full screen",
                  }}
                  onClick={hostFullScreen.toggle}
                />
                {/* Only where the tree is behind a panel: with the tree on screen
                    the next file is one click away in it, and these would be a
                    second way to do the same thing. */}
                {viewport.narrow && (
                  <>
                    <Button
                      subtle
                      iconProps={{ iconName: "FileCode" }}
                      text={`${visibleViewedCount}/${visibleFiles.length}`}
                      ariaLabel="Show the changed files"
                      tooltipProps={{ text: "Changed files" }}
                      onClick={() => setFilesOpen(true)}
                    />
                    <Button
                      subtle
                      iconProps={{ iconName: "ChevronLeft" }}
                      ariaLabel="Previous file in this step"
                      tooltipProps={{ text: "Previous file" }}
                      disabled={!previousFile}
                      onClick={() => previousFile && selectFile(previousFile)}
                    />
                    <Button
                      subtle
                      iconProps={{ iconName: "ChevronRight" }}
                      ariaLabel="Next file in this step"
                      tooltipProps={{ text: "Next file" }}
                      disabled={!nextFile}
                      onClick={() => nextFile && selectFile(nextFile)}
                    />
                  </>
                )}
              </div>
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
          </header>
          {review.error && (
            <MessageCard severity={MessageCardSeverity.Error}>{review.error}</MessageCard>
          )}
          {viewport.narrow ? (
            <div className="review-workspace narrow">{renderDiffCard()}</div>
          ) : (
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
              onRenderNearElement={() => filesColumn}
              onRenderFarElement={renderDiffCard}
            />
          )}
          {viewport.narrow && filesOpen && (
            <Panel
              className="files-panel"
              titleProps={{ text: `Changed files (${visibleViewedCount}/${visibleFiles.length})` }}
              onDismiss={() => setFilesOpen(false)}
            >
              {filesDrawer}
            </Panel>
          )}
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
          {clearFeedbackScope && (
            <ClearFeedbackDialog
              scope={clearFeedbackScope}
              stepTitle={selectedStep?.title}
              reviewerNames={review
                .reviewersWithFeedback(clearFeedbackScope === "step" ? selectedStep : undefined)
                .map((id) => resolveMention(id)?.displayName ?? id)}
              pending={review.pending}
              onDismiss={() => setClearFeedbackScope(undefined)}
              onConfirm={() => {
                review.clearFeedback(clearFeedbackScope === "step" ? selectedStep : undefined);
                setClearFeedbackScope(undefined);
              }}
            />
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
      </AttachmentContext.Provider>
    </MentionContext.Provider>
  );
}
