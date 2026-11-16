/** Reordering the pages on the camera screen (#20). */

/** Moves page `i` one place back (-1) or forward (1); out of range leaves the list as is. */
export function movePage<T>(pages: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (i < 0 || i >= pages.length || j < 0 || j >= pages.length) return pages;
  const next = [...pages];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function removePage<T>(pages: T[], i: number): T[] {
  return pages.filter((_, j) => j !== i);
}
