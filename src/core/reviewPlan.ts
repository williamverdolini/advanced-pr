import { stableHash } from "./hash";

export interface ReviewPlanMarker {
  planId: string;
  version: number;
}

export interface ReviewStep {
  stepId: string;
  order: number;
  title: string;
  isCatchAll: boolean;
  files: string[];
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

export interface StepPlan {
  planId: string;
  version: number;
  sourceThreadId?: number;
  steps: ReviewStep[];
  warnings: PlanWarning[];
  planHash: string;
}

interface ParsedSection {
  title: string;
  files: string[];
  explanation: string[];
}

const planMarkerPattern = /<!--\s*advanced-pr:v2\s+(\{.*?\})\s*-->/s;

export function parsePlanMarker(content: string): ReviewPlanMarker | undefined {
  const match = content.match(planMarkerPattern);
  if (!match) {
    return undefined;
  }

  try {
    const value = JSON.parse(match[1]) as Partial<ReviewPlanMarker> & { kind?: string };
    if (
      value.kind !== "review-plan" ||
      typeof value.planId !== "string" ||
      !value.planId ||
      !Number.isInteger(value.version) ||
      (value.version ?? 0) < 1
    ) {
      return undefined;
    }

    return { planId: value.planId, version: value.version as number };
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

  const sections = parseSections(content);
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
    for (const rawPath of section.files) {
      const normalized = normalizeRepositoryPath(rawPath);
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
    }

    steps.push(
      createStep(
        section.title,
        order,
        false,
        files,
        joinExplanation(section.explanation),
      ),
    );
  }

  const catchAllFiles = [...changedByKey.entries()]
    .filter(([key]) => !assigned.has(key))
    .map(([, path]) => path);
  steps.push(createStep("Everything else", steps.length, true, catchAllFiles));

  const canonical = [
    ...sections.map((section, order) => ({
      order,
      title: section.title,
      isCatchAll: false,
      files: section.files.map(normalizeRepositoryPath).sort(compareText),
    })),
    {
      order: sections.length,
      title: "Everything else",
      isCatchAll: true,
      files: [] as string[],
    },
  ];

  return {
    planId: marker.planId,
    version: marker.version,
    sourceThreadId,
    steps,
    warnings,
    planHash: stableHash(JSON.stringify(canonical)),
  };
}

/** `### Explain`, at any heading level, with or without a trailing colon. */
const explainHeadingPattern = /^#{2,6}\s*explain\s*:?\s*$/i;

function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | undefined;
  let inExplain = false;

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
      continue;
    }

    // Inside an explanation an indented bullet stays prose: it is the escape
    // hatch for writing a list without its items being read as file entries.
    const isIndented = /^\s/.test(rawLine);
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (current && bullet && !(inExplain && isIndented)) {
      current.files.push(bullet[1]);
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

function createStep(
  title: string,
  order: number,
  isCatchAll: boolean,
  files: string[],
  explanation?: string,
): ReviewStep {
  const sortedFiles = [...files].sort(compareText);
  return {
    stepId: `step-${stableHash(`${order}:${title}`)}`,
    order,
    title,
    isCatchAll,
    files,
    // Only the files take part: the explanation must not invalidate approvals.
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
