import * as React from "react";
import * as ReactDOM from "react-dom";
import { findMentionQuery, insertMention } from "../core/mentionQuery";
import { getCaretCoordinates } from "./caretCoordinates";
import {
  addIdentityToMru,
  getIdentityMru,
  searchIdentities,
  type DirectoryIdentity,
} from "../platform/identityService";

export interface MentionTypeaheadProps {
  inputRef: React.RefObject<HTMLTextAreaElement & HTMLInputElement>;
  value: string;
  /** Changes when the caret was moved without the text changing. */
  caretRevision?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  /**
   * Called before the text changes, so the editor can record how to turn the
   * inserted name back into a token.
   */
  onMentionInserted?: (identity: DirectoryIdentity) => void;
}

const searchDelayMs = 180;
const maxSuggestions = 8;
const listWidth = 260;

/**
 * Places the list just under the `@` that opened it, rather than under the
 * field: in a long comment the field's bottom edge can be far from where the
 * writing is happening. Kept inside the viewport horizontally.
 */
function anchorAt(
  input: HTMLTextAreaElement & HTMLInputElement,
  index: number,
): { left: number; top: number } {
  const caret = getCaretCoordinates(input, index);
  return {
    left: Math.max(8, Math.min(caret.left, window.innerWidth - listWidth - 8)),
    top: caret.top + caret.lineHeight,
  };
}

/**
 * The `@` typeahead for the comment editor.
 *
 * Two constraints shape it, and both come from living inside a Monaco view
 * zone: key events are stopped on the zone container, so React never sees
 * them and the keyboard has to be handled with a native listener on the
 * textarea itself; and the zone clips its content, so the list is rendered in
 * a portal on `document.body` rather than next to the field.
 */
export function MentionTypeahead({
  inputRef,
  value,
  caretRevision,
  disabled,
  onChange,
  onMentionInserted,
}: MentionTypeaheadProps): React.ReactElement | null {
  const [suggestions, setSuggestions] = React.useState<readonly DirectoryIdentity[]>([]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [anchor, setAnchor] = React.useState<{ left: number; top: number }>();
  const queryRef = React.useRef<ReturnType<typeof findMentionQuery>>();
  /**
   * Text produced by the last insertion. The inserted `@Display Name` reads as
   * an open query, so without this the list would reopen on the name just
   * chosen; any further typing changes the text and lifts the suppression.
   */
  const insertedTextRef = React.useRef<string>();
  const suggestionsRef = React.useRef<readonly DirectoryIdentity[]>([]);
  const activeIndexRef = React.useRef(0);

  // The native key handler is registered once and reads the current list and
  // cursor from refs; mirroring them has to happen after render, not during.
  React.useEffect(() => {
    suggestionsRef.current = suggestions;
    activeIndexRef.current = activeIndex;
  }, [activeIndex, suggestions]);

  const close = React.useCallback((): void => {
    queryRef.current = undefined;
    setSuggestions([]);
    setAnchor(undefined);
    setActiveIndex(0);
  }, []);

  const choose = React.useCallback(
    (identity: DirectoryIdentity): void => {
      const input = inputRef.current;
      const mention = queryRef.current;
      if (!input || !mention) {
        return;
      }

      // Registered before the change, because the editor converts the text to
      // its stored form in that very handler and needs the mapping by then.
      onMentionInserted?.(identity);
      const next = insertMention(input.value, mention, identity.displayName);
      insertedTextRef.current = next.text;
      onChange(next.text);
      void addIdentityToMru(identity.id);
      close();
      window.requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(next.caret, next.caret);
      });
    },
    [close, inputRef, onChange, onMentionInserted],
  );

  // Track what is being typed. `input` events are not blocked by the zone, so
  // React's onChange path would work too, but reading the caret needs the
  // element anyway.
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input || disabled) {
      close();
      return;
    }

    if (input.value === insertedTextRef.current) {
      return;
    }

    const mention = findMentionQuery(input.value, input.selectionStart ?? input.value.length);
    queryRef.current = mention;
    if (!mention) {
      setSuggestions([]);
      setAnchor(undefined);
      return;
    }

    setAnchor(anchorAt(input, mention.start));

    let active = true;
    const timer = window.setTimeout(() => {
      const lookup = mention.query
        ? searchIdentities(mention.query)
        : getIdentityMru();
      void lookup.then((found) => {
        if (active) {
          setSuggestions(found.slice(0, maxSuggestions));
          setActiveIndex(0);
        }
      });
    }, searchDelayMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [caretRevision, close, disabled, inputRef, value]);

  // The list is positioned from the field's rect, and the field scrolls with
  // the diff: without this it would stay behind, floating over unrelated code.
  React.useEffect(() => {
    const input = inputRef.current;
    if (!anchor || !input) {
      return;
    }

    const reposition = (): void => {
      const mention = queryRef.current;
      if (mention) {
        setAnchor(anchorAt(input, mention.start));
      }
    };

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    const onBlur = (): void => close();
    input.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      input.removeEventListener("blur", onBlur);
    };
  }, [anchor, close, inputRef]);

  // Native listener on the textarea: it runs at target phase, before the zone
  // container stops the event, which is why arrow keys work here at all.
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!queryRef.current || suggestionsRef.current.length === 0) {
        return;
      }

      const count = suggestionsRef.current.length;
      const move = (delta: number): void => {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((current) => (current + delta + count) % count);
      };

      switch (event.key) {
        case "ArrowDown":
          return move(1);
        case "ArrowUp":
          return move(-1);
        case "Enter":
        case "Tab":
          event.preventDefault();
          event.stopPropagation();
          choose(suggestionsRef.current[activeIndexRef.current]);
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        default:
          return;
      }
    };

    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, [choose, close, inputRef]);

  if (!anchor || suggestions.length === 0) {
    return null;
  }

  return ReactDOM.createPortal(
    <ul
      className="mention-suggestions"
      role="listbox"
      aria-label="People"
      style={{ left: anchor.left, top: anchor.top }}
    >
      {suggestions.map((identity, index) => (
        <li key={identity.id} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            className={index === activeIndex ? "active" : undefined}
            // The list lives outside the field: a plain click would blur it
            // first and close the typeahead before the selection lands.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(identity);
            }}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span className="mention-name">{identity.displayName}</span>
            {identity.uniqueName && (
              <span className="mention-unique">{identity.uniqueName}</span>
            )}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
