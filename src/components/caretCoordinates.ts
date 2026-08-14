export interface CaretCoordinates {
  /** Viewport coordinates of the character at the given index. */
  left: number;
  top: number;
  /** Height of the line it sits on, to place something under it. */
  lineHeight: number;
}

/**
 * A textarea exposes no geometry for its content, so the position of a
 * character is measured by laying the same text out in a hidden mirror that
 * copies every style affecting the layout, and reading where the marker lands.
 */
const mirroredProperties = [
  "direction",
  "boxSizing",
  "width",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

export function getCaretCoordinates(
  input: HTMLTextAreaElement | HTMLInputElement,
  index: number,
): CaretCoordinates {
  const style = window.getComputedStyle(input);
  const mirror = document.createElement("div");

  for (const property of mirroredProperties) {
    mirror.style.setProperty(
      property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      style.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
    );
  }

  // Off-screen, and wrapping the way a textarea does.
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.height = "auto";

  mirror.textContent = input.value.slice(0, index);
  const marker = document.createElement("span");
  // Non-empty so the span has a box even at the end of the text.
  marker.textContent = input.value.slice(index) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const rect = input.getBoundingClientRect();
  const lineHeight =
    Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
  const coordinates: CaretCoordinates = {
    left: rect.left + marker.offsetLeft - input.scrollLeft,
    top: rect.top + marker.offsetTop - input.scrollTop,
    lineHeight,
  };

  document.body.removeChild(mirror);
  return coordinates;
}
