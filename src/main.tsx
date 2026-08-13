import * as React from "react";
import * as ReactDOM from "react-dom";
import { App } from "./app/App";
import {
  initializeExtension,
  type PullRequestContext,
} from "./platform/extensionContext";

const listeners = new Set<(context: PullRequestContext) => void>();
const subscribeToContext = (listener: (context: PullRequestContext) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const publishContext = (context: PullRequestContext): void => {
  for (const listener of listeners) {
    listener(context);
  }
};

async function start(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Application root was not found.");
  }

  const session = await initializeExtension(publishContext);
  ReactDOM.render(
    <React.StrictMode>
      <App initialSession={session} subscribeToContext={subscribeToContext} />
    </React.StrictMode>,
    root,
  );
}

void start();
