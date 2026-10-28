// rtl.bidi data tables: RTL language tags and physical → logical CSS mappings.

/** BCP 47 language tags whose default writing direction is right to left. Matched on the primary subtag only. */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "ar", // Arabic
  "arc", // Imperial Aramaic
  "ckb", // Central Kurdish (Sorani)
  "dv", // Divehi (Dhivehi)
  "fa", // Persian
  "glk", // Gilaki
  "he", // Hebrew
  "iw", // Hebrew (legacy tag)
  "ji", // Yiddish (legacy tag)
  "nqo", // N'Ko
  "ps", // Pashto
  "sd", // Sindhi
  "syr", // Syriac
  "ug", // Uyghur
  "ur", // Urdu
  "yi", // Yiddish
]);

/** True when the primary subtag of a `lang` value names an RTL language. */
export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(lang.trim().toLowerCase().split("-")[0] ?? "");
}

/**
 * Physical side properties. A declaration such as `margin-left` fixes one physical side, so the layout
 * mirrors wrongly on right-to-left pages; the logical equivalents (`margin-inline-start`, …) follow the
 * text direction instead.
 */
export const PHYSICAL_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["margin-left", "margin-inline-start"],
  ["margin-right", "margin-inline-end"],
  ["padding-left", "padding-inline-start"],
  ["padding-right", "padding-inline-end"],
  ["border-left", "border-inline-start"],
  ["border-right", "border-inline-end"],
  ["border-left-color", "border-inline-start-color"],
  ["border-left-style", "border-inline-start-style"],
  ["border-left-width", "border-inline-start-width"],
  ["border-right-color", "border-inline-end-color"],
  ["border-right-style", "border-inline-end-style"],
  ["border-right-width", "border-inline-end-width"],
  ["border-top-left-radius", "border-start-start-radius"],
  ["border-top-right-radius", "border-start-end-radius"],
  ["border-bottom-left-radius", "border-end-start-radius"],
  ["border-bottom-right-radius", "border-end-end-radius"],
]);

/** Properties whose `left` and `right` keywords resolve to direction-relative values. */
export const SIDE_KEYWORD_PROPERTIES: ReadonlyMap<string, Record<string, string>> = new Map([
  ["text-align", { left: "start", right: "end" }],
  ["float", { left: "inline-start", right: "inline-end" }],
  ["clear", { left: "inline-start", right: "inline-end" }],
]);

/** Unicode ranges of the RTL scripts (Arabic, Hebrew, Syriac, Thaana, N'Ko) as strong directional characters. */
export const RTL_STRONG = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
/** Latin, Greek, and Cyrillic letters as the strong LTR characters to expect embedded in RTL pages. */
export const LTR_STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u04FF]/u;
