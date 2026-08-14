import type { PullRequestWorkspace } from "../platform/azureDevOpsClient";

/**
 * The Markdown the plan editor opens with: the plan as it stands when there is
 * one, otherwise a single step listing every changed file.
 */
export function createPlanTemplate(workspace: PullRequestWorkspace): string {
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
