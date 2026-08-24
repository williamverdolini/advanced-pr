import * as monaco from "monaco-editor";
import { computeBlockFoldingRanges, type FoldingMarkers } from "../core/blockFolding";

/**
 * The languages this bundle ships as a Monarch tokenizer and nothing else: no
 * document symbols, no folding provider, so Monaco falls back to folding by
 * indentation and the sticky header at the top of the editor reads `{`.
 *
 * TypeScript and JavaScript are absent on purpose: their worker provides
 * document symbols, which the sticky header prefers over any folding range and
 * which already name the enclosing class and method. CSS, HTML and JSON bring
 * folding providers of their own.
 *
 * The marker patterns mirror Monaco's own language configuration, because
 * registering a folding provider replaces the indentation model wholesale —
 * `#region` folding included — so the regions have to be produced here as well.
 * There is no public API to read them back off the language.
 */
const braceLanguages: readonly { readonly id: string; readonly markers: FoldingMarkers }[] = [
  { id: "csharp", markers: { start: /^\s*#region\b/, end: /^\s*#endregion\b/ } },
  {
    id: "java",
    markers: {
      start: /^\s*\/\/\s*(?:(?:#?region\b)|(?:<editor-fold\b))/,
      end: /^\s*\/\/\s*(?:(?:#?endregion\b)|(?:<\/editor-fold>))/,
    },
  },
];

let registered = false;

/**
 * Idempotent: providers are registered on the Monaco singleton, so a second
 * editor must not add a second provider — Monaco would ask both and merge the
 * two identical answers.
 */
export function registerBlockFolding(): void {
  if (registered) {
    return;
  }
  registered = true;

  for (const language of braceLanguages) {
    monaco.languages.registerFoldingRangeProvider(language.id, {
      provideFoldingRanges: (model) => [
        ...computeBlockFoldingRanges(model.getLinesContent(), {
          tabSize: model.getOptions().tabSize,
          markers: language.markers,
        }),
      ],
    });
  }
}
