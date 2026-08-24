/**
 * The one or two letters that stand in for a picture that is missing or has not
 * loaded yet.
 *
 * `Rossi, Maria` reads as a surname first, which is how Azure DevOps writes a
 * display name in some organizations: the comma is what says so, and taking the
 * first letter of each part on either side of it gives the same pair either way.
 */
export function initialsFromName(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, " ")
    .split(/[\s,._-]+/)
    .filter((part) => /\p{Letter}|\p{Number}/u.test(part));

  if (parts.length === 0) {
    return "?";
  }

  const first = firstCharacter(parts[0]);
  // The last part rather than the second: a middle name must not push the
  // surname out of the pair.
  const last = parts.length > 1 ? firstCharacter(parts[parts.length - 1]) : "";
  return (first + last).toLocaleUpperCase();
}

function firstCharacter(part: string): string {
  // Not `part[0]`: an emoji or an accented letter outside the BMP is more than
  // one code unit, and half of one renders as a replacement character.
  return [...part].find((character) => /\p{Letter}|\p{Number}/u.test(character)) ?? "";
}
