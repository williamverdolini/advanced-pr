import { isDarkColor } from "../core/theme";

export type HostTheme = "light" | "dark";

/**
 * Azure DevOps applies its theme as CSS variables on the body, so the theme is
 * derived from the resulting background rather than from host class names,
 * which are not a supported contract.
 */
export function readHostTheme(): HostTheme {
  const style = getComputedStyle(document.body);
  const background =
    style.getPropertyValue("--background-color").trim() || style.backgroundColor;
  return isDarkColor(background) ? "dark" : "light";
}

/**
 * Calls `onChange` immediately and again whenever the host swaps its theme.
 * Returns a dispose function.
 */
export function observeHostTheme(onChange: (theme: HostTheme) => void): () => void {
  let current = readHostTheme();
  onChange(current);

  const observer = new MutationObserver(() => {
    const next = readHostTheme();
    if (next !== current) {
      current = next;
      onChange(next);
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });

  return () => observer.disconnect();
}
