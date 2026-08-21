/**
 * Copies text to the clipboard, reporting whether it worked. The extension runs
 * in a sandboxed iframe where the async clipboard API is not always granted, so
 * a failure there falls back to the selection-based copy, which needs nothing
 * beyond the user gesture that is already in progress.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyBySelection(value);
  }
}

function copyBySelection(value: string): boolean {
  const holder = document.createElement("textarea");
  holder.value = value;
  // Moved off screen rather than hidden: what is not displayed cannot be
  // selected, and without a selection there is nothing to copy.
  holder.style.position = "fixed";
  holder.style.top = "-1000px";
  holder.setAttribute("readonly", "true");
  document.body.appendChild(holder);
  try {
    holder.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    holder.remove();
  }
}
