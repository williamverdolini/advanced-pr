import * as React from "react";
import { observeViewport, readViewport, type Viewport } from "../platform/viewport";

/** The shape of the screen, kept current while the window or device changes. */
export function useViewport(): Viewport {
  const [viewport, setViewport] = React.useState(readViewport);
  React.useEffect(() => observeViewport(setViewport), []);
  return viewport;
}
