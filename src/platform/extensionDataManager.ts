import * as SDK from "azure-devops-extension-sdk";
import {
  type IExtensionDataManager,
  type IExtensionDataService,
} from "azure-devops-extension-api/Common";

/** Values only the signed-in reader can read back, on any device. */
export const userScope = { scopeType: "User", scopeValue: "Me" };

let managerPromise: Promise<IExtensionDataManager> | undefined;

export function getExtensionDataManager(): Promise<IExtensionDataManager> {
  if (!managerPromise) {
    managerPromise = (async () => {
      const [service, accessToken] = await Promise.all([
        SDK.getService<IExtensionDataService>("ms.vss-features.extension-data-service"),
        SDK.getAccessToken(),
      ]);
      return service.getExtensionDataManager(SDK.getExtensionContext().id, accessToken);
    })();
  }

  return managerPromise;
}
