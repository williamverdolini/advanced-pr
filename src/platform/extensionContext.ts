import * as SDK from "azure-devops-extension-sdk";

export interface PullRequestContext {
  pullRequestId?: number;
  repositoryId?: string;
  projectId?: string;
}

export interface ExtensionSession {
  context: PullRequestContext;
  userId: string;
  userName: string;
  isHosted: boolean;
}

export async function initializeExtension(
  onContextChanged: (context: PullRequestContext) => void,
): Promise<ExtensionSession> {
  const isHosted = window.parent !== window;
  if (!isHosted) {
    return {
      context: {},
      userId: "local-user",
      userName: "Local developer",
      isHosted: false,
    };
  }

  await SDK.init({ applyTheme: true, loaded: false });
  SDK.register(SDK.getContributionId(), {
    pageTitle: () => "Guided Review",
    updateContext: (context: unknown) => onContextChanged(normalizeContext(context)),
    isInvisible: () => false,
    isDisabled: () => false,
  });
  await SDK.ready();

  const webContext = SDK.getWebContext();
  const context = {
    ...normalizeContext(SDK.getConfiguration()),
    projectId: webContext.project?.id,
  };
  const user = SDK.getUser();
  const userName = user.name;
  await SDK.notifyLoadSucceeded();

  return { context, userId: user.id, userName, isHosted: true };
}

function normalizeContext(value: unknown): PullRequestContext {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const nested =
    record.pullRequest && typeof record.pullRequest === "object"
      ? (record.pullRequest as Record<string, unknown>)
      : undefined;
  const pullRequestId = numberValue(record.pullRequestId ?? nested?.pullRequestId);
  const repositoryId = stringValue(record.repositoryId ?? nested?.repositoryId);

  return { pullRequestId, repositoryId };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}


/**
 * Contribution id of this tab, `publisher.extension.contribution`, which is the
 * value the host reads from `_a` to decide which tab to open. Outside a host
 * there is no SDK to ask, and no link worth building either.
 */
export function getTabContributionId(): string | undefined {
  try {
    return SDK.getContributionId();
  } catch {
    return undefined;
  }
}
