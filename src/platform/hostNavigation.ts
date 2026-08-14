import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common";

// `CommonServiceIds` is an ambient const enum, unreadable under isolatedModules.
const hostNavigationServiceId = "ms.vss-features.host-navigation-service";

let servicePromise: Promise<IHostNavigationService | undefined> | undefined;

function getService(): Promise<IHostNavigationService | undefined> {
  servicePromise ??= SDK.getService<IHostNavigationService>(hostNavigationServiceId).catch(
    () => undefined,
  );
  return servicePromise;
}

/**
 * Query parameters of the host page, not of the extension iframe. Outside a
 * host, in local preview, there are none.
 */
export async function getHostQueryParams(): Promise<Record<string, string>> {
  const service = await getService();
  if (!service) {
    return {};
  }

  try {
    return await service.getQueryParams();
  } catch {
    return {};
  }
}

/**
 * Writes parameters on the host page's URL, so a reload comes back to the same
 * place. An empty value removes the parameter.
 */
export async function setHostQueryParams(parameters: Record<string, string>): Promise<void> {
  const service = await getService();
  try {
    service?.setQueryParams(parameters);
  } catch {
    // Navigation state is a convenience: never let it break the review.
  }
}
