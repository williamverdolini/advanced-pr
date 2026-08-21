import * as SDK from "azure-devops-extension-sdk";
import type { ILocationService } from "azure-devops-extension-api/Common";
import type { PullRequestWorkspace } from "./azureDevOpsClient";

// `CommonServiceIds` is an ambient const enum, unreadable under isolatedModules.
const locationServiceId = "ms.vss-features.location-service";

/**
 * The pull request's own page. `_links.web` is what Azure DevOps itself links
 * to and is used when the response carried it; the organization root plus the
 * route is the fallback, because that link is not guaranteed and a share that
 * quietly stops working is worse than one built by hand.
 *
 * The route is written with names rather than ids: both resolve, but a link is
 * read by people before it is followed, and one made of two GUIDs says nothing
 * about where it goes. Ids are only the last resort, when the project name did
 * not come back with the pull request.
 */
export async function getPullRequestPageUrl(
  workspace: PullRequestWorkspace,
): Promise<string | undefined> {
  if (workspace.webUrl) {
    return workspace.webUrl;
  }

  const project = workspace.projectName ?? workspace.projectId;
  if (!project) {
    return undefined;
  }

  try {
    const service = await SDK.getService<ILocationService>(locationServiceId);
    const organization = (await service.getServiceLocation())?.replace(/\/+$/, "");
    return organization
      ? `${organization}/${encodeURIComponent(project)}` +
          `/_git/${encodeURIComponent(workspace.repositoryName)}` +
          `/pullrequest/${workspace.id}`
      : undefined;
  } catch {
    return undefined;
  }
}
