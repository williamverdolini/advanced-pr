const languagesByExtension: Record<string, string> = {
  cs: "csharp",
  css: "css",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * The Monaco language id for a path. An extension that is not listed falls back
 * to plain text: syntax highlighting guessed wrong is worse than none.
 */
export function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  return (extension && languagesByExtension[extension]) || "plaintext";
}
