export type Rgb = readonly [number, number, number];

/**
 * Parses the colour formats Azure DevOps uses for its theme variables: hex,
 * `rgb()`/`rgba()`, and the bare `r, g, b` triples of the palette variables.
 */
export function parseCssColor(value: string): Rgb | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const digits =
      hex.length === 3
        ? [...hex].map((digit) => digit + digit)
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
    return digits.map((digit) => Number.parseInt(digit, 16)) as unknown as Rgb;
  }

  const channels = (text.match(/^rgba?\(([^)]+)\)$/i)?.[1] ?? text)
    .split(/[,\s/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);

  return channels.length === 3 && channels.every((channel) => Number.isFinite(channel))
    ? (channels as unknown as Rgb)
    : undefined;
}

/**
 * Perceived brightness (ITU-R BT.601). Used to pick the Monaco theme from the
 * host background instead of sniffing Azure DevOps class names.
 */
export function isDarkColor(value: string): boolean {
  const rgb = parseCssColor(value);
  if (!rgb) {
    return false;
  }

  const [red, green, blue] = rgb;
  return 0.299 * red + 0.587 * green + 0.114 * blue < 128;
}
