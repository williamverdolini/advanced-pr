import * as SDK from "azure-devops-extension-sdk";
import type { IHostPageLayoutService } from "azure-devops-extension-api/Common";

// `CommonServiceIds` is an ambient const enum, unreadable under isolatedModules.
const hostPageLayoutServiceId = "ms.vss-features.host-page-layout-service";

let servicePromise: Promise<IHostPageLayoutService | undefined> | undefined;

function getService(): Promise<IHostPageLayoutService | undefined> {
  servicePromise ??= SDK.getService<IHostPageLayoutService>(hostPageLayoutServiceId).catch(
    () => undefined,
  );
  return servicePromise;
}

/**
 * The host's own full-screen mode: it hides the organization header, the pull
 * request header and the tab strip, and gives this iframe the whole page. It is
 * what makes the review usable on a phone, where the tab is otherwise a few
 * hundred pixels tall.
 */
export async function isHostFullScreen(): Promise<boolean> {
  const service = await getService();
  try {
    return (await service?.getFullScreenMode()) ?? false;
  } catch {
    return false;
  }
}

export async function setHostFullScreen(fullScreen: boolean): Promise<void> {
  const service = await getService();
  try {
    service?.setFullScreenMode(fullScreen);
  } catch {
    // Outside a host, or on a host that does not offer it: the review still
    // works, it just stays inside the tab.
  }
}
