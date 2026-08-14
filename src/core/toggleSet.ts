/**
 * Membership updates for the `ReadonlySet` values held in React state. React
 * compares state by reference, so a set is replaced rather than mutated, and
 * every function here returns the set it was given when nothing changes: an
 * unchanged reference is what lets React skip the re-render.
 */

export function withMember<T>(
  set: ReadonlySet<T>,
  value: T,
  member: boolean,
): ReadonlySet<T> {
  if (set.has(value) === member) {
    return set;
  }

  const next = new Set(set);
  if (member) {
    next.add(value);
  } else {
    next.delete(value);
  }

  return next;
}

/** For a control that has no separate on and off, such as an expander. */
export function toggleMember<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  return withMember(set, value, !set.has(value));
}

/**
 * The bulk form, for a folder acting on every file under it. One copy is made
 * however many values change, and none when they all already match.
 */
export function withMembers<T>(
  set: ReadonlySet<T>,
  values: Iterable<T>,
  member: boolean,
): ReadonlySet<T> {
  const changing = [...values].filter((value) => set.has(value) !== member);
  if (changing.length === 0) {
    return set;
  }

  const next = new Set(set);
  for (const value of changing) {
    if (member) {
      next.add(value);
    } else {
      next.delete(value);
    }
  }

  return next;
}
