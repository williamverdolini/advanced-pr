import * as React from "react";
import { isHostFullScreen, setHostFullScreen } from "../platform/hostLayout";

export interface HostFullScreen {
  fullScreen: boolean;
  toggle: () => void;
}

/**
 * The host's full-screen mode, mirrored into React state. The host owns the
 * flag — it can also be left on from an earlier visit — so it is read once on
 * mount rather than assumed to start off.
 */
export function useHostFullScreen(): HostFullScreen {
  const [fullScreen, setFullScreen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void isHostFullScreen().then((current) => {
      if (active) {
        setFullScreen(current);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const toggle = (): void => {
    const next = !fullScreen;
    setFullScreen(next);
    void setHostFullScreen(next);
  };

  return { fullScreen, toggle };
}
