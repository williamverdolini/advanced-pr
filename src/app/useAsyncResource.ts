import * as React from "react";

export interface AsyncResource<T> {
  data?: T;
  error?: string;
  loading: boolean;
  /**
   * Replaces the loaded value without going through `load` again, for an action
   * that has already re-read part of it.
   */
  setData: (data: T) => void;
}

/**
 * Loads a value and tracks the outcome, discarding a response that a newer call
 * has superseded: React has no `switchMap`, so the flag below is what keeps a
 * slow answer for a file the reviewer has left from overwriting the one now on
 * screen.
 *
 * `load` is the dependency that decides when to reload, so it must be memoized
 * by the caller; `undefined` means there is nothing to load and clears the
 * previous value.
 */
export function useAsyncResource<T>(
  load: (() => Promise<T>) | undefined,
  fallbackMessage: string,
): AsyncResource<T> {
  const [state, setState] = React.useState<Omit<AsyncResource<T>, "setData">>({
    loading: false,
  });

  const setData = React.useCallback((data: T): void => {
    setState({ data, loading: false });
  }, []);

  React.useEffect(() => {
    if (!load) {
      setState({ loading: false });
      return;
    }

    let active = true;
    setState({ loading: true });
    void load()
      .then((data) => {
        if (active) {
          setState({ data, loading: false });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setState({
            error: reason instanceof Error ? reason.message : fallbackMessage,
            loading: false,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [fallbackMessage, load]);

  return { ...state, setData };
}
