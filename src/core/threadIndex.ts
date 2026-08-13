export interface FileThreadReference {
  id: number;
  filePath?: string;
  position?: {
    startLine: number;
  };
}

export function indexThreadsByFile<TThread extends FileThreadReference>(
  threads: readonly TThread[],
): ReadonlyMap<string, readonly TThread[]> {
  const index = new Map<string, TThread[]>();

  for (const thread of threads) {
    if (!thread.filePath) {
      continue;
    }

    const fileThreads = index.get(thread.filePath) ?? [];
    fileThreads.push(thread);
    index.set(thread.filePath, fileThreads);
  }

  for (const fileThreads of index.values()) {
    fileThreads.sort((left, right) => {
      const lineOrder = (left.position?.startLine ?? Number.MAX_SAFE_INTEGER) -
        (right.position?.startLine ?? Number.MAX_SAFE_INTEGER);
      return lineOrder || left.id - right.id;
    });
  }

  return index;
}