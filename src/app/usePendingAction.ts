import * as React from "react";

export interface PendingAction {
  pending: boolean;
  error?: string;
  /**
   * Runs `action`, holding the pending flag for its duration and turning a
   * failure into `error`. `fallbackMessage` overrides the hook's own for an
   * action that needs to name what it was doing.
   */
  run: (action: () => Promise<void>, fallbackMessage?: string) => Promise<void>;
}

/**
 * The pending and error state around a write to Azure DevOps. Every such action
 * disables its own control while it runs and reports its own failure, so a call
 * that fails never blanks the review around it.
 */
export function usePendingAction(fallbackMessage: string): PendingAction {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const run = React.useCallback(
    async (action: () => Promise<void>, message = fallbackMessage): Promise<void> => {
      setPending(true);
      setError(undefined);
      try {
        await action();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : message);
      } finally {
        setPending(false);
      }
    },
    [fallbackMessage],
  );

  return { pending, error, run };
}
