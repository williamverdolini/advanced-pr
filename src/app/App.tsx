import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import {
  loadPullRequestWorkspace,
  refreshThreads,
  type PullRequestWorkspace,
} from "../platform/azureDevOpsClient";
import type { ExtensionSession, PullRequestContext } from "../platform/extensionContext";
import { observeHostTheme } from "../platform/hostTheme";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { useAsyncResource } from "./useAsyncResource";
import "./app.css";

export interface AppProps {
  initialSession: ExtensionSession;
  subscribeToContext: (listener: (context: PullRequestContext) => void) => () => void;
}

/**
 * Loads the pull request the host has named and hands it to the review. Nothing
 * about the review itself lives here: this is the session, and the one fetch it
 * depends on.
 */
export function App({ initialSession, subscribeToContext }: AppProps): React.ReactElement {
  const [context, setContext] = React.useState(initialSession.context);
  const workspaceRef = React.useRef<PullRequestWorkspace>();

  // Nothing to load until the host has named a pull request, and never in the
  // local preview, where there is no Azure DevOps to ask.
  const loadWorkspace = React.useMemo(
    () =>
      initialSession.isHosted && context.pullRequestId
        ? () => loadPullRequestWorkspace(context)
        : undefined,
    [context, initialSession.isHosted],
  );
  const {
    data: workspace,
    error,
    loading,
    setData: setWorkspace,
  } = useAsyncResource(loadWorkspace, "Unable to load the pull request.");

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

  // Comment actions must not rebuild the diff editor, so only the threads are
  // re-read; files and pull request metadata keep their identity.
  const refresh = React.useCallback(async (): Promise<void> => {
    const current = workspaceRef.current;
    if (current) {
      setWorkspace(await refreshThreads(current));
    }
  }, [setWorkspace]);

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
          <ReviewWorkspace
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
