import { stableHash } from "./hash";
import { readMarkerPayload } from "./marker";

/**
 * When feedback on a step stops counting.
 *
 * `plan-hash` is the original rule: every decision is dropped as soon as the
 * plan document changes at all, because a decision carries the hash of the plan
 * it was given against. It is what every plan written before this field existed
 * uses, and it stays the default so those pull requests keep behaving exactly as
 * they did.
 *
 * `manual` keeps feedback until the step it was given on is renamed, removed, or
 * cleared by the pull request author. Under it a step's identity is its title,
 * so reordering steps and revising their file lists costs nothing.
 */
export type PlanInvalidation = "plan-hash" | "manual";

export interface ReviewPlanMarker {
  planId: string;
  version: number;
  /** Absent in every plan written before the field existed: see the type. */
  invalidation?: PlanInvalidation;
}

export interface ReviewStep {
  stepId: string;
  order: number;
  title: string;
  isCatchAll: boolean;
  files: string[];
  /**
   * The files nested under a file entry in the plan, keyed by the path they hang
   * from — a test alongside the class it exercises, typically. Context for
   * reading the step, not work belonging to it: a related path is never claimed
   * by the step, so it does not count towards its file total and still lands in
   * the catch-all unless some step lists it on its own line. Like
   * `explanation`, it stays out of the canonical structure, so adding one never
   * invalidates an approval.
   */
  relatedFiles: ReadonlyMap<string, readonly string[]>;
  fingerprint: string;
  /**
   * Optional notes the author wrote under an `### Explain` heading. Descriptive
   * only: it is deliberately absent from the canonical structure, so editing it
   * changes neither `planHash` nor any step fingerprint, and therefore never
   * invalidates approvals already given (§4.3).
   */
  explanation?: string;
}

export type PlanWarningKind =
  | "duplicate-path"
  | "duplicate-title"
  | "stale-entry"
  | "case-collision";

export interface PlanWarning {
  kind: PlanWarningKind;
  message: string;
  path?: string;
}

/**
 * Whether a warning is worth putting in front of the reader.
 *
 * A stale entry is not: it says the plan names a file the pull request no longer
 * has, which is what a later push removing that file looks like. Nothing is
 * broken and there is nothing to do — the file is left out of its step, the plan
 * reads the same to everyone, and opening the editor already shows it gone. The
 * others are the author's mistakes, and each of them changes what gets reviewed:
 * a path claimed by two steps, two steps with one title, two paths that differ
 * only in case.
 *
 * The warning itself is still produced. It says why a listed file is in no step,
 * which is worth having when the plan is being written rather than read.
 */
export function isActionablePlanWarning(warning: PlanWarning): boolean {
  return warning.kind !== "stale-entry";
}

export interface StepPlan {
  planId: string;
  version: number;
  invalidation: PlanInvalidation;
  sourceThreadId?: number;
  steps: ReviewStep[];
  warnings: PlanWarning[];
  planHash: string;
}

interface ParsedFileEntry {
  path: string;
  related: string[];
}

interface ParsedSection {
  title: string;
  files: ParsedFileEntry[];
  explanation: string[];
}

export function parsePlanMarker(content: string): ReviewPlanMarker | undefined {
  const payload = readMarkerPayload(content);
  if (!payload) {
    return undefined;
  }

  try {
    const value = JSON.parse(payload) as Partial<ReviewPlanMarker> & { kind?: string };
    if (
      value.kind !== "review-plan" ||
      typeof value.planId !== "string" ||
      !value.planId ||
      !Number.isInteger(value.version) ||
      (value.version ?? 0) < 1
    ) {
      return undefined;
    }

    return {
      planId: value.planId,
      version: value.version as number,
      // Anything but the one opt-in value reads as the original rule, so a plan
      // written before this field existed, or by a tool that does not know about
      // it, is never switched to the new one by accident.
      invalidation: value.invalidation === "manual" ? "manual" : "plan-hash",
    };
  } catch {
    return undefined;
  }
}

export function buildStepPlan(
  content: string,
  changedFiles: readonly string[],
  marker: ReviewPlanMarker,
  sourceThreadId?: number,
): StepPlan {
  const warnings: PlanWarning[] = [];
  const changedByKey = new Map<string, string>();

  for (const file of changedFiles) {
    const normalized = normalizeRepositoryPath(file);
    const key = normalized.toLocaleLowerCase();
    const existing = changedByKey.get(key);
    if (existing && existing !== normalized) {
      warnings.push({
        kind: "case-collision",
        path: normalized,
        message: `Changed paths '${existing}' and '${normalized}' differ only by case.`,
      });
    } else {
      changedByKey.set(key, normalized);
    }
  }

  const invalidation = marker.invalidation ?? "plan-hash";
  const sections = parseSections(content);
  const identities = assignStepIdentities(
    sections.map((section) => section.title),
    invalidation,
  );
  const seenTitles = new Set<string>();
  const assigned = new Set<string>();
  const steps: ReviewStep[] = [];

  for (const [order, section] of sections.entries()) {
    const titleKey = section.title.toLocaleLowerCase();
    if (seenTitles.has(titleKey)) {
      warnings.push({
        kind: "duplicate-title",
        message: `Step title '${section.title}' appears more than once.`,
      });
    }
    seenTitles.add(titleKey);

    const files: string[] = [];
    const relatedFiles = new Map<string, readonly string[]>();
    for (const entry of section.files) {
      const normalized = normalizeRepositoryPath(entry.path);
      const pathKey = normalized.toLocaleLowerCase();
      if (assigned.has(pathKey)) {
        warnings.push({
          kind: "duplicate-path",
          path: normalized,
          message: `'${normalized}' is already assigned to an earlier step.`,
        });
        continue;
      }

      const changedPath = changedByKey.get(pathKey);
      if (!changedPath) {
        warnings.push({
          kind: "stale-entry",
          path: normalized,
          message: `'${normalized}' is not part of the current pull request.`,
        });
        continue;
      }

      assigned.add(pathKey);
      files.push(changedPath);

      const related = resolveRelatedFiles(entry.related, changedPath, changedByKey, warnings);
      if (related.length > 0) {
        relatedFiles.set(changedPath, related);
      }
    }

    steps.push(
      createStep({
        stepId: identities.stepIds[order],
        title: section.title,
        order,
        isCatchAll: false,
        files,
        relatedFiles,
        explanation: joinExplanation(section.explanation),
      }),
    );
  }

  const catchAllFiles = [...changedByKey.entries()]
    .filter(([key]) => !assigned.has(key))
    .map(([, path]) => path);
  steps.push(
    createStep({
      stepId: identities.catchAllStepId,
      title: catchAllTitle,
      order: steps.length,
      isCatchAll: true,
      files: catchAllFiles,
    }),
  );

  const canonical = [
    ...sections.map((section, order) => ({
      order,
      title: section.title,
      isCatchAll: false,
      // Only the file entries themselves: what is nested under them is context,
      // and rewriting it must not invalidate an approval.
      files: section.files
        .map((entry) => normalizeRepositoryPath(entry.path))
        .sort(compareText),
    })),
    {
      order: sections.length,
      title: catchAllTitle,
      isCatchAll: true,
      files: [] as string[],
    },
  ];

  return {
    planId: marker.planId,
    version: marker.version,
    invalidation,
    sourceThreadId,
    steps,
    warnings,
    planHash: stableHash(JSON.stringify(canonical)),
  };
}

/** The title of the step that collects whatever no other step claimed. */
const catchAllTitle = "Everything else";

/**
 * Reserved for the catch-all under `manual`, and claimed before any section
 * title can slug to it: a step actually called "Catch all" is then the one that
 * gets numbered, and the catch-all keeps one id across every revision of a plan.
 */
const catchAllSlug = "catch-all";

/** Long enough to stay recognisable, short enough to read inside a comment. */
const maxSlugLength = 48;

interface StepIdentities {
  stepIds: string[];
  catchAllStepId: string;
}

function assignStepIdentities(
  titles: readonly string[],
  invalidation: PlanInvalidation,
): StepIdentities {
  if (invalidation !== "manual") {
    // The original scheme, kept verbatim: the ids of a plan already carrying
    // decisions must not move under it.
    return {
      stepIds: titles.map((title, order) => `step-${stableHash(`${order}:${title}`)}`),
      catchAllStepId: `step-${stableHash(`${titles.length}:${catchAllTitle}`)}`,
    };
  }

  const claimed = new Map<string, number>([[catchAllSlug, 1]]);
  return {
    stepIds: titles.map((title) => `step-${claimSlug(claimed, toSlug(title))}`),
    catchAllStepId: `step-${catchAllSlug}`,
  };
}

/**
 * Two steps with the same title are the same step as far as identity goes, which
 * is what `duplicate-title` warns about. Numbering the later ones keeps their
 * decisions apart anyway, at the cost of making those ids depend on the order.
 */
function claimSlug(claimed: Map<string, number>, slug: string): string {
  const count = (claimed.get(slug) ?? 0) + 1;
  claimed.set(slug, count);
  return count === 1 ? slug : `${slug}-${count}`;
}

/**
 * A title as an identifier: lower case, words joined by hyphens. Readable on
 * purpose — the id is written into every decision comment, so anyone reading the
 * pull request, or writing an event by hand, can tell which step it belongs to.
 */
function toSlug(title: string): string {
  const slug = title
    .toLocaleLowerCase()
    .normalize("NFKD")
    // Combining marks left behind by the decomposition, so an accented title
    // and its plain spelling do not become two different steps.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, maxSlugLength)
    .replace(/^-+|-+$/g, "");
  // A title with nothing a slug can keep — an emoji, a non-Latin script — still
  // needs an identity, and the hash of the title is one that does not move.
  return slug || stableHash(title);
}

/** `### Explain`, at any heading level, with or without a trailing colon. */
const explainHeadingPattern = /^#{2,6}\s*explain\s*:?\s*$/i;

function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | undefined;
  let inExplain = false;
  // The indentation the current section's file entries sit at, learnt from its
  // first bullet: everything deeper than that hangs from the entry above it.
  let entryIndent: number | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (current && explainHeadingPattern.test(line)) {
      inExplain = true;
      continue;
    }

    const numberedHeading = line.match(/^(?:#{1,6}\s*)?\d+[.)]\s+(.+)$/);
    const markdownHeading = line.match(/^#{2,6}\s+(.+)$/);
    const heading = numberedHeading?.[1] ?? markdownHeading?.[1];

    if (heading) {
      current = { title: heading.trim(), files: [], explanation: [] };
      sections.push(current);
      inExplain = false;
      entryIndent = undefined;
      continue;
    }

    // Inside an explanation an indented bullet stays prose: it is the escape
    // hatch for writing a list without its items being read as file entries.
    const indent = rawLine.length - rawLine.trimStart().length;
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (current && bullet && !(inExplain && indent > 0)) {
      const parent = current.files.at(-1);
      if (parent && entryIndent !== undefined && indent > entryIndent) {
        parent.related.push(bullet[1]);
      } else {
        // Tolerant of a list indented as a whole: the shallowest bullet seen so
        // far is what counts as an entry, not column zero.
        entryIndent = entryIndent === undefined ? indent : Math.min(entryIndent, indent);
        current.files.push({ path: bullet[1], related: [] });
      }
      inExplain = false;
      continue;
    }

    if (current && inExplain) {
      current.explanation.push(rawLine.replace(/\s+$/, ""));
    }
  }

  return sections;
}

function joinExplanation(lines: readonly string[]): string | undefined {
  const text = lines.join("\n").trim();
  return text || undefined;
}

const noRelatedFiles: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The files nested under an entry, resolved against the pull request. Duplicates
 * and the parent itself are dropped, and nothing here is marked as assigned:
 * that is what keeps a related path out of the step's own file count.
 */
function resolveRelatedFiles(
  rawPaths: readonly string[],
  parentPath: string,
  changedByKey: ReadonlyMap<string, string>,
  warnings: PlanWarning[],
): string[] {
  const related: string[] = [];
  const seen = new Set<string>([parentPath.toLocaleLowerCase()]);

  for (const rawPath of rawPaths) {
    const normalized = normalizeRepositoryPath(rawPath);
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const changedPath = changedByKey.get(key);
    if (!changedPath) {
      warnings.push({
        kind: "stale-entry",
        path: normalized,
        message: `'${normalized}', listed under '${parentPath}', is not part of the current pull request.`,
      });
      continue;
    }

    related.push(changedPath);
  }

  return related;
}

function createStep({
  stepId,
  title,
  order,
  isCatchAll,
  files,
  relatedFiles = noRelatedFiles,
  explanation,
}: {
  stepId: string;
  title: string;
  order: number;
  isCatchAll: boolean;
  files: string[];
  relatedFiles?: ReadonlyMap<string, readonly string[]>;
  explanation?: string;
}): ReviewStep {
  const sortedFiles = [...files].sort(compareText);
  return {
    stepId,
    order,
    title,
    isCatchAll,
    files,
    relatedFiles,
    // Only the files take part: neither the explanation nor the related files
    // must invalidate approvals.
    fingerprint: stableHash(JSON.stringify(sortedFiles)),
    explanation,
  };
}

/**
 * The step a file belongs to. Assignment is exclusive: a path claimed by an
 * earlier step never reaches a later one, and whatever is left is in the
 * catch-all, so the first match is the only match.
 */
export function findStepForFile(
  steps: readonly ReviewStep[],
  path: string,
): ReviewStep | undefined {
  const wanted = normalizeRepositoryPath(path).toLocaleLowerCase();
  return steps.find((step) =>
    step.files.some((file) => file.toLocaleLowerCase() === wanted),
  );
}

export function normalizeRepositoryPath(value: string): string {
  const markdownLink = value.match(/^\[.*?\]\((.*?)\)$/)?.[1] ?? value;
  return markdownLink
    .replace(/^`|`$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "variant" });
}
