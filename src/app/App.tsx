import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { ContentSize } from "azure-devops-ui/Callout";
import { Card } from "azure-devops-ui/Card";
import { Dialog } from "azure-devops-ui/Dialog";
import { TitleSize } from "azure-devops-ui/Header";
import { IconSize } from "azure-devops-ui/Icon";
import { MoreButton } from "azure-devops-ui/Menu";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { SplitButton } from "azure-devops-ui/SplitButton";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import {
  Splitter,
  SplitterDirection,
  SplitterElementPosition,
} from "azure-devops-ui/Splitter";
import { DiffViewer, type DiffSelection } from "../components/DiffViewer";
import { FileTree } from "../components/FileTree";
import { Markdown } from "../components/Markdown";
import { MarkdownCommentEditor } from "../components/MarkdownCommentEditor";
import { contentSideForChange, isContentOnlyChange } from "../core/changeType";
import { buildInlineZones, type InlineZoneDescriptor } from "../core/inlineZones";
import { indexThreadsByFile } from "../core/threadIndex";
import {
  canApprovePullRequest,
  hasOutstandingChangesAfterApproval,
  reduceReviewEvents,
} from "../core/ledger";
import {
  appendLedgerEvent,
  createAnchoredThread,
  createReviewPlan,
  loadChangedFileDiff,
  loadPullRequestWorkspace,
  refreshThreads,
  replyToThread,
  setCommentLiked,
  setReviewerVote,
  setThreadResolved,
  updateCommentContent,
  type ChangedFile,
  type FileDiffContent,
  type PullRequestWorkspace,
  type ReviewThread,
} from "../platform/azureDevOpsClient";
import type { ExtensionSession, PullRequestContext } from "../platform/extensionContext";
import { observeHostTheme } from "../platform/hostTheme";
import { loadViewedFiles, saveViewedFiles } from "../platform/viewedFilesStore";
import "./app.css";

export interface AppProps {
  initialSession: ExtensionSession;
  subscribeToContext: (listener: (context: PullRequestContext) => void) => () => void;
}

export function App({ initialSession, subscribeToContext }: AppProps): React.ReactElement {
  const [context, setContext] = React.useState(initialSession.context);
  const [workspace, setWorkspace] = React.useState<PullRequestWorkspace>();
  const [error, setError] = React.useState<string>();
  const [loading, setLoading] = React.useState(false);
  const workspaceRef = React.useRef<PullRequestWorkspace>();

  React.useEffect(() => subscribeToContext(setContext), [subscribeToContext]);
  React.useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  // Publishes the host theme to CSS: rules that need a light-on-dark treatment
  // cannot express it through the host palette variables alone.
  React.useEffect(
    () =>
      observeHostTheme((theme) => {
        document.documentElement.setAttribute("data-theme", theme);
      }),
    [],
  );

  React.useEffect(() => {
    if (!initialSession.isHosted || !context.pullRequestId) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(undefined);
    void loadPullRequestWorkspace(context)
      .then((value) => {
        if (active) {
          setWorkspace(value);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load the pull request.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [context, initialSession.isHosted]);

  // Comment actions must not rebuild the diff editor, so only the threads are
  // re-read; files and pull request metadata keep their identity.
  const refresh = React.useCallback(async (): Promise<void> => {
    const current = workspaceRef.current;
    if (current) {
      setWorkspace(await refreshThreads(current));
    }
  }, []);

  return (
    <main className="app-shell">
      <section className="app-content">
        {!initialSession.isHosted && (
          <MessageCard severity={MessageCardSeverity.Info}>
            Local preview mode. Open the installed development tab in Azure DevOps to load a pull request.
          </MessageCard>
        )}
        {loading && <Spinner label="Loading pull request" size={SpinnerSize.large} />}
        {error && <MessageCard severity={MessageCardSeverity.Error}>{error}</MessageCard>}
        {workspace ? (
          <Workspace
            workspace={workspace}
            reviewerId={initialSession.userId}
            onRefresh={refresh}
          />
        ) : (
          !loading && !error && (
            <Card
              className="context-card"
              titleProps={{ text: "Pull request context", size: TitleSize.Medium }}
            >
              <dl className="context-grid">
                <dt>User</dt>
                <dd>{initialSession.userName}</dd>
                <dt>Pull request</dt>
                <dd>{context.pullRequestId ?? "Waiting for host context"}</dd>
                <dt>Repository</dt>
                <dd>{context.repositoryId ?? "Waiting for host context"}</dd>
                <dt>Project</dt>
                <dd>{context.projectId ?? "Provided by Azure DevOps web context"}</dd>
              </dl>
            </Card>
          )
        )}
      </section>
    </main>
  );
}

interface WorkspaceProps {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  onRefresh: () => Promise<unknown>;
}

function Workspace({ workspace, reviewerId, onRefresh }: WorkspaceProps): React.ReactElement {
  const [selectedFile, setSelectedFile] = React.useState<ChangedFile>();
  const [diff, setDiff] = React.useState<FileDiffContent>();
  const [diffError, setDiffError] = React.useState<string>();
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string>();
  const [actionPending, setActionPending] = React.useState(false);
  const [selectedStepId, setSelectedStepId] = React.useState(
    workspace.plan.steps.find((step) => step.files.length > 0)?.stepId,
  );
  const [selectedThreadId, setSelectedThreadId] = React.useState<number>();
  const [sideBySide, setSideBySide] = React.useState(false);
  const [collapsedThreads, setCollapsedThreads] = React.useState<ReadonlySet<number>>(new Set());
  const [draft, setDraft] = React.useState<DiffSelection>();
  const [signOffOpen, setSignOffOpen] = React.useState(false);
  const [explainExpanded, setExplainExpanded] = React.useState(false);
  const [planEditorOpen, setPlanEditorOpen] = React.useState(false);
  const [planDraft, setPlanDraft] = React.useState(() => createPlanTemplate(workspace));
  const [viewedFiles, setViewedFiles] = React.useState<ReadonlySet<string>>(new Set());
  // The range itself is kept out of state on purpose: a cursor drag must not
  // re-render the tree. Only whether a selection exists is tracked, and that
  // flips rarely.
  const selectionRef = React.useRef<DiffSelection>();
  const [hasSelection, setHasSelection] = React.useState(false);

  const reviewState = reduceReviewEvents(workspace.ledgerEvents, {
    planId: workspace.plan.planId,
    planVersion: workspace.plan.version,
    planHash: workspace.plan.planHash,
    stepFingerprints: new Map(
      workspace.plan.steps.map((step) => [step.stepId, step.fingerprint]),
    ),
  });
  const reviewerSteps = reviewState.stepStates.get(reviewerId);
  const displayedSteps = workspace.plan.steps.filter(
    (step) => !step.isCatchAll || step.files.length > 0,
  );
  const selectedStep = workspace.plan.steps.find((step) => step.stepId === selectedStepId);
  const currentReviewerVote = workspace.reviewers.find(
    (reviewer) => reviewer.id === reviewerId,
  )?.vote;
  const stepRequirements = workspace.plan.steps.map((step) => ({
    stepId: step.stepId,
    requiresApproval: step.files.length > 0,
  }));
  // No special case for a pull request without a plan: it simply has one step,
  // `Everything else`, treated exactly like any other.
  const signOffReady = canApprovePullRequest(reviewState, reviewerId, stepRequirements);
  // The ledger is append-only, so a past `pr-approved` never disappears. The
  // vote on the pull request is the source of truth: if it was reset (here or
  // in the classic UI, which writes no event), the sign-off is offered again.
  const signOffInEffect =
    reviewState.pullRequestDecisions.get(reviewerId) === "approved" &&
    currentReviewerVote === 10;

  // A pull request that is no longer active accepts no votes and no plan
  // changes, so every review action in the toolbar is closed.
  const reviewClosed = workspace.state !== "active";

  // A file that exists on one side only is shown as plain content, so there are
  // no sides to lay out and the one side it has is the one on screen.
  const contentOnly = selectedFile ? isContentOnlyChange(selectedFile.changeKind) : false;
  const contentSide = selectedFile ? contentSideForChange(selectedFile.changeKind) : "right";
  const splitView = sideBySide && !contentOnly;
  // Memoized: it feeds the memos that keep the view zones and decorations from
  // being rebuilt on every render.
  const visibleSides = React.useMemo<readonly ("left" | "right")[]>(
    () => (contentOnly ? [contentSide] : splitView ? ["left", "right"] : ["right"]),
    [contentOnly, contentSide, splitView],
  );

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
  const threadDecorations = React.useMemo(
    () =>
      fileThreads
        .filter((thread) => thread.position)
        // The base editor is not rendered inline, so its glyphs would be lost.
        .filter((thread) => visibleSides.includes(thread.position!.side))
        .map((thread) => ({
          id: thread.id,
          side: thread.position!.side,
          line: thread.position!.startLine,
          isOpen: thread.isOpen,
        })),
    [fileThreads, visibleSides],
  );
  const zoneLayout = React.useMemo(
    () =>
      buildInlineZones({
        filePath: selectedFile?.path ?? "",
        threads: fileThreads,
        draft: draft ? { side: draft.side, line: draft.endLine } : undefined,
        selectedThreadId,
        visibleSides,
        collapsedThreadIds: collapsedThreads,
      }),
    [collapsedThreads, draft, fileThreads, selectedFile, selectedThreadId, visibleSides],
  );
  const selectedThreadPosition = fileThreads.find(
    (thread) => thread.id === selectedThreadId,
  )?.position;
  // Only a new selection may scroll the diff; a refresh must leave it alone.
  const revealTarget = React.useMemo(
    () =>
      selectedThreadPosition && visibleSides.includes(selectedThreadPosition.side)
        ? { side: selectedThreadPosition.side, line: selectedThreadPosition.startLine }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedThreadId, visibleSides],
  );
  const visibleViewedCount = visibleFiles.filter((file) => viewedFiles.has(file.path)).length;

  React.useEffect(() => {
    if (!selectedFile) {
      return;
    }

    let active = true;
    setDiffLoading(true);
    setDiff(undefined);
    setDiffError(undefined);
    void loadChangedFileDiff(blobSource, selectedFile)
      .then((content) => {
        if (active) {
          setDiff(content);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setDiffError(reason instanceof Error ? reason.message : "Unable to load this file.");
        }
      })
      .finally(() => {
        if (active) {
          setDiffLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [blobSource, selectedFile]);

  React.useEffect(() => {
    let active = true;
    void loadViewedFiles(viewedScope).then((paths) => {
      if (active) {
        setViewedFiles(paths);
      }
    });

    return () => {
      active = false;
    };
  }, [viewedScope]);

  const writeStepEvent = async (
    step: PullRequestWorkspace["plan"]["steps"][number],
    kind: "step-approved" | "step-changes-requested" | "step-reset",
  ): Promise<void> => {
    setActionPending(true);
    setActionError(undefined);
    try {
      await appendLedgerEvent(
        workspace,
        kind === "step-approved"
          ? `✅ **Step approved: \`${step.title}\`**`
          : kind === "step-changes-requested"
            ? `⚠️ **Changes requested: \`${step.title}\`**`
            : `↩ **Step reset: \`${step.title}\`**`,
        {
          eventId: crypto.randomUUID(),
          kind,
          planId: workspace.plan.planId,
          planVersion: workspace.plan.version,
          planHash: workspace.plan.planHash,
          stepId: step.stepId,
          iteration: workspace.iterationId,
          stepFingerprint: step.fingerprint,
        },
      );
      if (kind === "step-changes-requested") {
        await setReviewerVote(workspace, reviewerId, -5);
      } else if (
        kind === "step-approved" &&
        currentReviewerVote === -5 &&
        !hasOutstandingChangesAfterApproval(reviewState, reviewerId, step.stepId)
      ) {
        await setReviewerVote(workspace, reviewerId, 0);
      }
      await onRefresh();
      if (kind === "step-approved") {
        const currentIndex = displayedSteps.findIndex((item) => item.stepId === step.stepId);
        const nextStep = displayedSteps
          .slice(currentIndex + 1)
          .find(
            (item) =>
              item.files.length > 0 && reviewerSteps?.get(item.stepId) !== "approved",
          );
        if (nextStep) {
          selectStep(nextStep);
        }
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Unable to update this step.");
    } finally {
      setActionPending(false);
    }
  };

  // Asks for the sign-off the moment the last required step is approved, and
  // only on that transition: dismissing it must not make it pop back.
  const signOffPromptedRef = React.useRef(false);
  React.useEffect(() => {
    if (!signOffReady || signOffInEffect || reviewClosed) {
      signOffPromptedRef.current = false;
      return;
    }

    if (!signOffPromptedRef.current) {
      signOffPromptedRef.current = true;
      setSignOffOpen(true);
    }
  }, [reviewClosed, signOffInEffect, signOffReady]);

  const approvePullRequest = async (): Promise<void> => {
    setActionPending(true);
    setActionError(undefined);
    try {
      await appendLedgerEvent(workspace, "✅ **Pull request approved**", {
        eventId: crypto.randomUUID(),
        kind: "pr-approved",
        planId: workspace.plan.planId,
        planVersion: workspace.plan.version,
        planHash: workspace.plan.planHash,
        iteration: workspace.iterationId,
      });
      await setReviewerVote(workspace, reviewerId, 10);
      setSignOffOpen(false);
      await onRefresh();
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "Unable to approve the pull request.",
      );
    } finally {
      setActionPending(false);
    }
  };

  const createPlan = async (): Promise<void> => {
    if (!planDraft.trim()) {
      return;
    }

    setActionPending(true);
    setActionError(undefined);
    try {
      await createReviewPlan(
        workspace,
        workspace.plan.sourceThreadId ? workspace.plan.planId : crypto.randomUUID(),
        workspace.plan.sourceThreadId ? workspace.plan.version + 1 : 1,
        planDraft,
      );
      setPlanEditorOpen(false);
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Unable to create the review plan.");
    } finally {
      setActionPending(false);
    }
  };

  const submitDraft = async (content: string): Promise<void> => {
    if (!selectedFile || !draft) {
      return;
    }

    await createAnchoredThread(workspace, selectedFile, draft, content);
    setDraft(undefined);
    await onRefresh();
  };

  const selectedStepStatus = selectedStep
    ? reviewerSteps?.get(selectedStep.stepId)
    : undefined;

  const selectStep = (step: PullRequestWorkspace["plan"]["steps"][number]): void => {
    setSelectedStepId(step.stepId);
    setSelectedThreadId(undefined);
    setDraft(undefined);
    const firstFile = workspace.files.find((file) => step.files.includes(file.path));
    setSelectedFile(firstFile);
  };

  const selectFile = React.useCallback((file: ChangedFile): void => {
    setSelectedFile(file);
    setSelectedThreadId(undefined);
    setDraft(undefined);
    selectionRef.current = undefined;
  }, []);

  const setThreadCollapsed = React.useCallback((threadId: number, collapsed: boolean): void => {
    setCollapsedThreads((current) => {
      if (current.has(threadId) === collapsed) {
        return current;
      }

      const next = new Set(current);
      if (collapsed) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }
      return next;
    });
  }, []);

  // Reaching a thread from the tree must always show it, even if its glyph was
  // used to collapse it earlier.
  const selectThread = React.useCallback(
    (file: ChangedFile, thread: ReviewThread): void => {
      setSelectedFile(file);
      setSelectedThreadId(thread.id);
      setThreadCollapsed(thread.id, false);
    },
    [setThreadCollapsed],
  );

  // The glyph is the only way back for a collapsed thread, so it toggles.
  const toggleThreadFromGlyph = React.useCallback((threadId: number): void => {
    setCollapsedThreads((current) => {
      const next = new Set(current);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
    setSelectedThreadId(threadId);
  }, []);

  const trackSelection = React.useCallback((selection: DiffSelection | undefined): void => {
    selectionRef.current = selection;
    setHasSelection(Boolean(selection));
  }, []);

  const commentOnSelection = React.useCallback((): void => {
    const selection = selectionRef.current;
    if (selection) {
      setDraft(selection);
      setSelectedThreadId(undefined);
    }
  }, []);

  // A click in the glyph margin comments the whole line, unless it lands inside
  // a live selection, in which case the selected range is what gets anchored.
  const requestComment = React.useCallback((anchor: DiffSelection): void => {
    const selection = selectionRef.current;
    const withinSelection =
      selection &&
      selection.side === anchor.side &&
      anchor.startLine >= selection.startLine &&
      anchor.startLine <= selection.endLine;
    setDraft(withinSelection ? selection : anchor);
    setSelectedThreadId(undefined);
  }, []);

  const setFilesViewed = React.useCallback(
    (paths: readonly string[], viewed: boolean): void => {
      setViewedFiles((current) => {
        const next = new Set(current);
        for (const path of paths) {
          if (viewed) {
            next.add(path);
          } else {
            next.delete(path);
          }
        }
        void saveViewedFiles(viewedScope, next);
        return next;
      });
    },
    [viewedScope],
  );

  // The file commands live in the card header, on the title's line: in the card
  // content they cost a row of height on every file.
  const diffCommands = [
    {
      id: "diff-layout",
      text: "Diff layout",
      renderButton: () =>
        contentOnly ? (
          <span className="diff-toolbar-note" key="diff-layout">
            {contentSide === "left" ? "Deleted file: previous contents" : "New file: full contents"}
          </span>
        ) : (
          <div className="diff-layout-switch" role="group" aria-label="Diff layout" key="diff-layout">
            <button
              type="button"
              className={sideBySide ? undefined : "active"}
              aria-pressed={!sideBySide}
              onClick={() => setSideBySide(false)}
            >
              Inline
            </button>
            <button
              type="button"
              className={sideBySide ? "active" : undefined}
              aria-pressed={sideBySide}
              onClick={() => setSideBySide(true)}
            >
              Side by side
            </button>
          </div>
        ),
    },
    {
      id: "comment-on-selection",
      text: "Comment on selection",
      iconProps: { iconName: "CommentAdd" },
      disabled: !hasSelection,
      important: true,
      tooltipProps: {
        text: hasSelection ? "Comment on the selected code" : "Select code in the file first",
      },
      onActivate: () => {
        commentOnSelection();
        return true;
      },
    },
  ];

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
            onCollapse={() => setThreadCollapsed(thread.id, true)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    );
  };

  return (
    <section className="workspace-shell">
      {/* Title, branches and counters live in the Azure DevOps header that
          embeds this iframe: repeating them here would only cost height. */}
      <header className="review-header">
        <div className="review-toolbar">
          <ol className="step-wizard" aria-label="Review steps">
            {displayedSteps.map((step, index) => {
              const status = reviewerSteps?.get(step.stepId);
              const viewedCount = step.files.filter((path) => viewedFiles.has(path)).length;
              return (
                <li
                  className={selectedStep?.stepId === step.stepId ? "active" : undefined}
                  key={step.stepId}
                >
                  <button type="button" onClick={() => selectStep(step)}>
                    <span className={`step-index ${status ?? ""}`}>{index + 1}</span>
                    <span className="step-label">{step.title}</span>
                    <span className="step-count">{viewedCount}/{step.files.length}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="toolbar-actions">
            {selectedStep && (
              <SplitButton
                disabled={actionPending || reviewClosed || selectedStep.files.length === 0}
                buttonProps={{
                  text: selectedStepStatus === "approved" ? "Approved step" : "Approve step",
                  disabled: selectedStepStatus === "approved",
                  tooltipProps: {
                    text: describeStepApproval(
                      selectedStep.files.length,
                      selectedStepStatus,
                      reviewClosed,
                    ),
                  },
                  onClick: () => void writeStepEvent(selectedStep, "step-approved"),
                }}
                menuButtonProps={{
                  contextualMenuProps: {
                    onActivate: (menuItem) => {
                      if (menuItem.id === "approve-step") {
                        void writeStepEvent(selectedStep, "step-approved");
                      } else if (menuItem.id === "request-step-changes") {
                        void writeStepEvent(selectedStep, "step-changes-requested");
                      } else if (menuItem.id === "reset-step") {
                        void writeStepEvent(selectedStep, "step-reset");
                      }
                    },
                    menuProps: {
                      id: "advanced-pr-step-actions",
                      items: [
                      {
                        // The menu lists every decision, the main action
                        // included: reaching for the dropdown should not hide
                        // the one command the reviewer is most likely after.
                        id: "approve-step",
                        text: "Approve step",
                        iconProps: {
                          iconName: "CompletedSolid",
                          className: "feedback-icon feedback-icon-success",
                          size: IconSize.medium,
                        },
                        disabled: selectedStepStatus === "approved",
                      },
                      {
                        id: "request-step-changes",
                        text: "Request changes",
                        iconProps: {
                          iconName: "AwayStatus",
                          className: "feedback-icon feedback-icon-waiting",
                          size: IconSize.medium,
                        },
                      },
                      {
                        id: "reset-step",
                        text: "Reset step",
                        iconProps: {
                          iconName: "CircleRing",
                          className: "feedback-icon feedback-icon-neutral",
                          size: IconSize.medium,
                        },
                        hidden: !selectedStepStatus,
                      },
                      ],
                    },
                  },
                }}
              />
            )}
            {/* The sign-off has no toolbar button on purpose: completing the
                steps is what raises it, through the dialog. */}
            {reviewerId === workspace.authorId && (
              <MoreButton
                disabled={actionPending || reviewClosed}
                contextualMenuProps={{
                  onActivate: (menuItem) => {
                    if (menuItem.id === "toggle-plan-editor") {
                      setPlanEditorOpen((open) => !open);
                    }
                  },
                  menuProps: {
                    id: "advanced-pr-more-actions",
                    items: [
                      {
                        id: "toggle-plan-editor",
                        text: workspace.plan.sourceThreadId ? "Edit plan" : "Create plan",
                        iconProps: { iconName: "Edit", size: IconSize.small },
                      },
                    ],
                  },
                }}
              />
            )}
          </div>
        </div>
        {planEditorOpen && reviewerId === workspace.authorId && (
          <div className="plan-editor toolbar-plan-editor">
            <textarea
              aria-label="Review plan Markdown"
              value={planDraft}
              disabled={actionPending}
              onChange={(event) => setPlanDraft(event.target.value)}
            />
            <div className="plan-editor-actions">
              <Button
                text={workspace.plan.sourceThreadId ? "Save new version" : "Create plan"}
                primary
                disabled={actionPending || reviewClosed || !planDraft.trim()}
                onClick={() => void createPlan()}
              />
              <Button
                text="Cancel"
                disabled={actionPending}
                onClick={() => setPlanEditorOpen(false)}
              />
            </div>
          </div>
        )}
        {reviewClosed && (
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
      {actionError && <MessageCard severity={MessageCardSeverity.Error}>{actionError}</MessageCard>}
      <Splitter
        className="review-workspace"
        ariaLabel="Files splitter"
        splitterDirection={SplitterDirection.Vertical}
        fixedElement={SplitterElementPosition.Near}
        initialFixedSize={280}
        minFixedSize={180}
        maxFixedSize={720}
        nearElementClassName="workspace-pane"
        farElementClassName="workspace-pane"
        onRenderNearElement={() => (
          <div className="files-column">
            {selectedStep?.explanation && (
              <details className="explain-panel" open>
                <summary>
                  <span className="explain-title">Explain</span>
                  <span className="explain-step">{selectedStep.title}</span>
                  <Button
                    subtle
                    className="explain-expand"
                    iconProps={{ iconName: "FullScreen", size: IconSize.small }}
                    ariaLabel="Read the explanation in a larger view"
                    tooltipProps={{ text: "Expand" }}
                    onClick={(event) => {
                      // The button lives inside <summary>, whose default action
                      // is to collapse the panel underneath it.
                      event.preventDefault();
                      event.stopPropagation();
                      setExplainExpanded(true);
                    }}
                  />
                </summary>
                <Markdown className="explain-body" content={selectedStep.explanation} />
              </details>
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
          titleProps={{ text: selectedFile?.path ?? "Diff", size: TitleSize.Medium }}
          headerCommandBarItems={selectedFile ? diffCommands : undefined}
        >
          {!selectedFile && <p className="empty-pane">Select a file to view its diff.</p>}
          {diffLoading && <Spinner label="Loading file" />}
          {diffError && <MessageCard severity={MessageCardSeverity.Warning}>{diffError}</MessageCard>}
          {zoneLayout.hiddenThreadCount > 0 && (
            <MessageCard severity={MessageCardSeverity.Info}>
              {zoneLayout.hiddenThreadCount} more comments on this file are listed in the tree but
              not shown inline.
            </MessageCard>
          )}
          {selectedFile && diff && (
            <DiffViewer
              original={diff.original}
              modified={diff.modified}
              language={diff.language}
              filePath={selectedFile.path}
              zones={zoneLayout.zones}
              renderZone={renderZone}
              renderSideBySide={splitView}
              singleFile={contentOnly}
              singleFileSide={contentSide}
              threadDecorations={threadDecorations}
              selectedThreadId={selectedThreadId}
              revealTarget={revealTarget}
              onSelectionChange={trackSelection}
              onSelectThread={toggleThreadFromGlyph}
              onRequestComment={requestComment}
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
      {signOffOpen && (
        <SignOffDialog
          workspace={workspace}
          reviewerId={reviewerId}
          currentVote={currentReviewerVote}
          pending={actionPending}
          onDismiss={() => setSignOffOpen(false)}
          onConfirm={() => void approvePullRequest()}
        />
      )}
      {workspace.plan.warnings.length > 0 && (
        <MessageCard severity={MessageCardSeverity.Warning}>
          {workspace.plan.warnings.map((warning) => warning.message).join(" ")}
        </MessageCard>
      )}
    </section>
  );
}

/**
 * Approving the last step is not a vote (§5.3): the whole pull request is a
 * separate, explicit decision, and this dialog is where it is stated, with
 * what it covers and what it does to the reviewer's global vote.
 */
function SignOffDialog({
  workspace,
  reviewerId,
  currentVote,
  pending,
  onDismiss,
  onConfirm,
}: {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  currentVote?: number;
  pending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const reviewedSteps = workspace.plan.steps.filter((step) => step.files.length > 0);
  const myOpenThreads = workspace.threads.filter(
    (thread) =>
      thread.isOpen && thread.comments.some((comment) => comment.authorId === reviewerId),
  );

  return (
    <Dialog
      titleProps={{ text: "Approve pull request" }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", disabled: pending, onClick: onDismiss },
        { text: "Approve pull request", primary: true, disabled: pending, onClick: onConfirm },
      ]}
    >
      <p>
        You are approving the whole pull request: {reviewedSteps.length}{" "}
        {reviewedSteps.length === 1 ? "step" : "steps"}, {workspace.files.length}{" "}
        {workspace.files.length === 1 ? "file" : "files"}.
      </p>
      <p>
        Your vote on the pull request becomes <strong>Approved</strong>
        {currentVote !== undefined && currentVote !== 0 && (
          <> (it is currently {describeVote(currentVote)})</>
        )}
        .
      </p>
      {myOpenThreads.length > 0 && (
        <MessageCard severity={MessageCardSeverity.Warning}>
          {myOpenThreads.length} {myOpenThreads.length === 1 ? "thread" : "threads"} you took part
          in {myOpenThreads.length === 1 ? "is" : "are"} still open. You can approve anyway.
        </MessageCard>
      )}
    </Dialog>
  );
}

/**
 * The step command is always on screen, so it has to say why it cannot act
 * rather than disappear and leave the toolbar looking different per pull
 * request.
 */
function describeStepApproval(
  fileCount: number,
  status: "approved" | "changes-requested" | undefined,
  reviewClosed: boolean,
): string {
  if (reviewClosed) {
    return "This pull request is no longer active";
  }
  if (fileCount === 0) {
    return "This step has no files to review";
  }
  if (status === "approved") {
    return "You approved this step";
  }

  return "Approve this step";
}

function describeVote(vote: number): string {
  switch (vote) {
    case 10:
      return "Approved";
    case 5:
      return "Approved with suggestions";
    case -5:
      return "Waiting for author";
    case -10:
      return "Rejected";
    default:
      return "No vote";
  }
}

function createPlanTemplate(workspace: PullRequestWorkspace): string {
  const configuredSteps = workspace.plan.sourceThreadId
    ? workspace.plan.steps.filter((step) => !step.isCatchAll)
    : [];
  if (configuredSteps.length > 0) {
    return configuredSteps
      .flatMap((step, index) => [
        `${index + 1}. ${step.title}`,
        ...(step.explanation ? ["### Explain", step.explanation, ""] : []),
        ...step.files.map((file) => `- ${file}`),
        "",
      ])
      .join("\n")
      .trim();
  }

  // The `### Explain` block is optional; the placeholder is how an author finds
  // out it exists at all.
  return [
    "1. Review step",
    "### Explain",
    "Optional notes about this step. Delete this block if you do not need it.",
    "",
    ...workspace.files.map((file) => `- ${file.path}`),
  ].join("\n");
}

interface InlineThreadCardProps {
  workspace: PullRequestWorkspace;
  thread: ReviewThread;
  reviewerId: string;
  selected: boolean;
  onSelect: (threadId: number) => void;
  onCollapse: () => void;
  onRefresh: () => Promise<unknown>;
}

/**
 * A thread rendered inside the diff. It owns its own pending and error state so
 * a failed reply never blanks the whole review, and its React state survives a
 * refresh because the view zone keeps its key.
 */
function InlineThreadCard({
  workspace,
  thread,
  reviewerId,
  selected,
  onSelect,
  onCollapse,
  onRefresh,
}: InlineThreadCardProps): React.ReactElement {
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [editingCommentId, setEditingCommentId] = React.useState<number>();
  const [editText, setEditText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const run = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      await action();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update this comment.");
    } finally {
      setPending(false);
    }
  };

  const anchorLabel = thread.position
    ? `${thread.position.side === "left" ? "Base" : "Changed"} · line ${thread.position.startLine}`
    : "File comment";
  // Azure DevOps likes individual comments; the thread-level action targets the
  // one that opened the discussion, which is what the count in the tree shows.
  const rootComment = thread.comments[0];
  const likedByMe = rootComment?.likedBy.includes(reviewerId) ?? false;

  return (
    <article
      className={selected ? "inline-thread selected" : "inline-thread"}
      onClick={() => onSelect(thread.id)}
    >
      <header>
        <span className={thread.isOpen ? "thread-state open" : "thread-state resolved"} />
        <strong>{thread.isOpen ? "Open" : "Resolved"}</strong>
        <span className="inline-thread-anchor">{anchorLabel}</span>
        <Button
          subtle
          iconProps={{ iconName: "ChevronUp" }}
          ariaLabel="Collapse this comment"
          tooltipProps={{ text: "Collapse. Reopen it from the comment icon in the margin" }}
          onClick={onCollapse}
        />
      </header>
      <>
          <div className="inline-thread-comments">
            {thread.comments.map((comment) => (
              <section key={comment.id}>
                <div className="inline-comment-meta">
                  <strong>{comment.authorName}</strong>
                  <time dateTime={comment.publishedDate}>
                    {formatDate(comment.publishedDate)}
                  </time>
                  {comment.authorId === reviewerId && editingCommentId !== comment.id && (
                    <Button
                      subtle
                      iconProps={{ iconName: "Edit" }}
                      ariaLabel="Edit this comment"
                      tooltipProps={{ text: "Edit" }}
                      disabled={pending}
                      onClick={() => {
                        setEditingCommentId(comment.id);
                        setEditText(comment.content);
                      }}
                    />
                  )}
                </div>
                {editingCommentId === comment.id ? (
                  <MarkdownCommentEditor
                    value={editText}
                    disabled={pending}
                    submitLabel="Save"
                    placeholder="Edit your comment"
                    onChange={setEditText}
                    onCancel={() => setEditingCommentId(undefined)}
                    onSubmit={() =>
                      void run(async () => {
                        await updateCommentContent(
                          workspace,
                          thread.id,
                          comment.id,
                          editText.trim(),
                        );
                        setEditingCommentId(undefined);
                      })
                    }
                  />
                ) : (
                  <Markdown content={comment.content} />
                )}
              </section>
            ))}
          </div>
          {error && <p className="inline-thread-error">{error}</p>}
          <div className="inline-thread-actions">
            <Button
              text="Reply"
              disabled={pending}
              onClick={() => setReplyOpen((open) => !open)}
            />
            <Button
              text={thread.isOpen ? "Resolve" : "Reopen"}
              primary={thread.isOpen}
              disabled={pending}
              onClick={() =>
                void run(() => setThreadResolved(workspace, thread.id, thread.isOpen))
              }
            />
            {rootComment && (
              <Button
                subtle
                iconProps={{ iconName: likedByMe ? "LikeSolid" : "Like" }}
                ariaLabel={`${likedByMe ? "Remove like" : "Like"}, ${rootComment.likeCount} so far`}
                tooltipProps={{
                  text: `${likedByMe ? "Remove like" : "Like"} (${rootComment.likeCount})`,
                }}
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    setCommentLiked(workspace, thread.id, rootComment.id, !likedByMe),
                  )
                }
              />
            )}
          </div>
          {replyOpen && (
            <MarkdownCommentEditor
              value={replyText}
              disabled={pending}
              submitLabel="Reply"
              placeholder="Write a reply"
              onChange={setReplyText}
              onCancel={() => {
                setReplyOpen(false);
                setReplyText("");
              }}
              onSubmit={() =>
                void run(async () => {
                  await replyToThread(workspace, thread.id, replyText.trim());
                  setReplyText("");
                  setReplyOpen(false);
                })
              }
            />
          )}
        </>
    </article>
  );
}

function InlineComposer({
  anchor,
  onCancel,
  onSubmit,
}: {
  anchor: DiffSelection | undefined;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<void>;
}): React.ReactElement {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(value.trim());
      setValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the comment.");
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="inline-thread inline-composer">
      <header>
        <strong>New comment</strong>
        <span className="inline-thread-anchor">
          {anchor
            ? anchor.startLine === anchor.endLine
              ? `Line ${anchor.startLine}`
              : `Lines ${anchor.startLine}–${anchor.endLine}`
            : ""}
        </span>
      </header>
      {error && <p className="inline-thread-error">{error}</p>}
      <MarkdownCommentEditor
        value={value}
        disabled={pending}
        submitLabel="Comment"
        placeholder="Write a comment on this code"
        onChange={setValue}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
    </article>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
