import * as SDK from "azure-devops-extension-sdk";
import type { IVssIdentityService } from "azure-devops-extension-api/Identities";

// `IdentityServiceIds` is an ambient const enum, which cannot be read under
// isolatedModules; the contribution id is inlined instead.
const identityServiceId = "ms.vss-features.identity-service";

export interface DirectoryIdentity {
  /** Azure DevOps identity id, lower-cased: the value a mention token carries. */
  id: string;
  displayName: string;
  uniqueName?: string;
  imageUrl?: string;
}

/**
 * The host's own identity picker service, the one the native comment editor
 * uses. It runs in the host page rather than in the extension, so the search
 * does not go through the extension's own scopes.
 */
let servicePromise: Promise<IVssIdentityService | undefined> | undefined;

function getService(): Promise<IVssIdentityService | undefined> {
  servicePromise ??= SDK.getService<IVssIdentityService>(identityServiceId).catch(
    () => undefined,
  );
  return servicePromise;
}

export async function isIdentityServiceAvailable(): Promise<boolean> {
  return Boolean(await getService());
}

export async function searchIdentities(query: string): Promise<DirectoryIdentity[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const service = await getService();
  if (!service) {
    return [];
  }

  try {
    // Groups and teams too: mentioning a team is part of what the native
    // editor offers, and it notifies every member.
    const results = await service.searchIdentitiesAsync(trimmed, ["user", "group"]);
    return remember(results);
  } catch {
    return [];
  }
}

export async function getIdentityMru(): Promise<DirectoryIdentity[]> {
  const service = await getService();
  if (!service) {
    return [];
  }

  try {
    const results = await service.getIdentityMruAsync();
    return remember(results);
  } catch {
    return [];
  }
}

/**
 * Every identity this module has ever seen, from a search, from the MRU or from
 * an explicit lookup. Ids that could not be resolved are remembered as such, so
 * a comment mentioning a departed account does not re-query forever.
 */
const known = new Map<string, DirectoryIdentity | undefined>();

/**
 * The entities exactly as the service returned them. Feeding one back into the
 * MRU means handing back the same shape it produced, which our normalised view
 * has deliberately thrown away.
 */
const rawEntities = new Map<string, unknown>();

/**
 * Reads the cache without going to the network. It is what lets a mention just
 * picked from the typeahead render with its name straight away: the identity is
 * already in hand, and waiting for the comment to be saved before resolving it
 * would show `@unknown` in the preview of the very name just chosen.
 */
export function getKnownIdentity(id: string): DirectoryIdentity | undefined {
  return known.get(id.toLowerCase());
}

function remember(entities: readonly unknown[]): DirectoryIdentity[] {
  const identities: DirectoryIdentity[] = [];
  for (const entity of entities) {
    const identity = toDirectoryIdentity(entity);
    if (!identity) {
      continue;
    }

    known.set(identity.id, identity);
    rawEntities.set(identity.id, entity);
    identities.push(identity);
  }
  return identities;
}

/**
 * Promotes a picked identity in the host's most recently used list, so the
 * empty-input suggestions learn from use the way the native picker does.
 * A convenience: a failure here must not disturb writing a comment.
 */
export async function addIdentityToMru(id: string): Promise<void> {
  const entity = rawEntities.get(id.toLowerCase());
  const service = await getService();
  if (!entity || !service) {
    return;
  }

  try {
    await service.addMruIdentitiesAsync([entity as Parameters<typeof service.addMruIdentitiesAsync>[0][number]]);
  } catch {
    // Ignored on purpose.
  }
}

export async function resolveIdentities(
  ids: readonly string[],
): Promise<ReadonlyMap<string, DirectoryIdentity>> {
  const missing = ids.map((id) => id.toLowerCase()).filter((id) => !known.has(id));

  for (const id of new Set(missing)) {
    // The service searches by text; an identity id is accepted as the query,
    // and the match is confirmed against the returned id rather than assumed.
    const matches = await searchIdentities(id);
    known.set(id, matches.find((identity) => identity.id === id));
  }

  const found = new Map<string, DirectoryIdentity>();
  for (const id of ids) {
    const identity = known.get(id.toLowerCase());
    if (identity) {
      found.set(id.toLowerCase(), identity);
    }
  }

  return found;
}

/**
 * The service types only guarantee `entityId`, while real payloads carry the
 * picker's richer shape. Every field that could hold the Azure DevOps identity
 * id is considered, because that is the one a mention token must contain.
 */
function toDirectoryIdentity(entity: unknown): DirectoryIdentity | undefined {
  if (!entity || typeof entity !== "object") {
    return undefined;
  }

  const record = entity as Record<string, unknown>;
  const id = firstString(record.localId, record.entityId, record.originId, record.id);
  const displayName = firstString(record.displayName, record.mail, record.signInAddress);
  if (!id || !displayName) {
    return undefined;
  }

  return {
    id: id.toLowerCase(),
    displayName,
    uniqueName: firstString(record.mail, record.signInAddress, record.uniqueName),
    imageUrl: firstString(record.image, record.imageUrl),
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
