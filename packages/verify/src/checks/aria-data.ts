// WAI-ARIA 1.2 data used by the a11y.aria-* checks: role names and the roles HTML allows on a few common elements.

export const ABSTRACT_ROLES: ReadonlySet<string> = new Set(["command", "composite", "input", "landmark", "range", "roletype", "section", "sectionhead", "select", "structure", "widget", "window"]);

const CONCRETE_ROLES = `alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem`;

/** Digital Publishing (DPUB-ARIA) and Graphics ARIA roles. */
const MODULE_ROLES = `doc-abstract doc-acknowledgments doc-afterword doc-appendix doc-backlink doc-biblioentry doc-bibliography doc-biblioref doc-chapter doc-colophon doc-conclusion doc-cover doc-credit doc-credits doc-dedication doc-endnote doc-endnotes doc-epigraph doc-epilogue doc-errata doc-example doc-footnote doc-foreword doc-glossary doc-glossref doc-index doc-introduction doc-noteref doc-notice doc-pagebreak doc-pagefooter doc-pageheader doc-pagelist doc-part doc-preface doc-prologue doc-pullquote doc-qna doc-subtitle doc-tip doc-toc graphics-document graphics-object graphics-symbol`;

export const ROLES: ReadonlySet<string> = new Set(`${CONCRETE_ROLES} ${MODULE_ROLES}`.split(" "));

/**
 * Roles HTML allows on elements where the allowed set is small and well defined (ARIA in HTML), including the implicit role.
 * Elements missing here are not checked: their allowed sets are large or depend on attributes.
 */
export const ALLOWED_ROLES: Readonly<Record<string, ReadonlySet<string>>> = {
  button: new Set("button checkbox combobox link menuitem menuitemcheckbox menuitemradio option radio switch tab".split(" ")),
  h1: new Set("heading none presentation tab doc-subtitle".split(" ")),
  h2: new Set("heading none presentation tab doc-subtitle".split(" ")),
  h3: new Set("heading none presentation tab doc-subtitle".split(" ")),
  h4: new Set("heading none presentation tab doc-subtitle".split(" ")),
  h5: new Set("heading none presentation tab doc-subtitle".split(" ")),
  h6: new Set("heading none presentation tab doc-subtitle".split(" ")),
  ul: new Set("list directory group listbox menu menubar none presentation radiogroup tablist toolbar tree".split(" ")),
  ol: new Set("list directory group listbox menu menubar none presentation radiogroup tablist toolbar tree".split(" ")),
  li: new Set("listitem menuitem menuitemcheckbox menuitemradio option none presentation radio separator tab treeitem doc-biblioentry doc-endnote".split(" ")),
  nav: new Set("navigation menu menubar none presentation tablist doc-index doc-pagelist doc-toc".split(" ")),
  hr: new Set("separator none presentation doc-pagebreak".split(" ")),
};

/** The closest role name within two edits, for "did you mean" hints. */
export function nearestRole(token: string): string | undefined {
  return nearest(token, ROLES);
}

function nearest(token: string, names: Iterable<string>): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const name of names) {
    const distance = editDistance(token, name);
    if (distance <= 2 && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name;
}

/**
 * What a WAI-ARIA 1.2 attribute accepts: true/false ("bool"), true/false/undefined ("bool?"), true/false/mixed ("tristate"),
 * one token ("token"), a list of tokens ("tokens"), a whole number with a minimum ("int"), any number ("number"),
 * or text and id references, which are not validated here ("free").
 */
export type AriaValue =
  | { kind: "bool" | "bool?" | "tristate" | "number" | "free" }
  | { kind: "token" | "tokens"; values: readonly string[] }
  | { kind: "int"; min: number };

const bool: AriaValue = { kind: "bool" };
const boolUndef: AriaValue = { kind: "bool?" };
const tristate: AriaValue = { kind: "tristate" };
const free: AriaValue = { kind: "free" };
const number: AriaValue = { kind: "number" };
const int = (min: number): AriaValue => ({ kind: "int", min });
const token = (...values: string[]): AriaValue => ({ kind: "token", values });

export const ARIA_ATTRIBUTES: Readonly<Record<string, AriaValue>> = {
  "aria-activedescendant": free,
  "aria-atomic": bool,
  "aria-autocomplete": token("inline", "list", "both", "none"),
  "aria-braillelabel": free,
  "aria-brailleroledescription": free,
  "aria-busy": bool,
  "aria-checked": tristate,
  "aria-colcount": int(-1),
  "aria-colindex": int(1),
  "aria-colindextext": free,
  "aria-colspan": int(1),
  "aria-controls": free,
  "aria-current": token("page", "step", "location", "date", "time", "true", "false"),
  "aria-describedby": free,
  "aria-description": free,
  "aria-details": free,
  "aria-disabled": bool,
  "aria-dropeffect": { kind: "tokens", values: ["copy", "execute", "link", "move", "none", "popup"] },
  "aria-errormessage": free,
  "aria-expanded": boolUndef,
  "aria-flowto": free,
  "aria-grabbed": boolUndef,
  "aria-haspopup": token("false", "true", "menu", "listbox", "tree", "grid", "dialog"),
  "aria-hidden": boolUndef,
  "aria-invalid": token("grammar", "false", "spelling", "true"),
  "aria-keyshortcuts": free,
  "aria-label": free,
  "aria-labelledby": free,
  "aria-level": int(1),
  "aria-live": token("off", "polite", "assertive"),
  "aria-modal": bool,
  "aria-multiline": bool,
  "aria-multiselectable": bool,
  "aria-orientation": token("horizontal", "vertical", "undefined"),
  "aria-owns": free,
  "aria-placeholder": free,
  "aria-posinset": int(1),
  "aria-pressed": tristate,
  "aria-readonly": bool,
  "aria-relevant": { kind: "tokens", values: ["additions", "removals", "text", "all"] },
  "aria-required": bool,
  "aria-roledescription": free,
  "aria-rowcount": int(-1),
  "aria-rowindex": int(1),
  "aria-rowindextext": free,
  "aria-rowspan": int(0),
  "aria-selected": boolUndef,
  "aria-setsize": int(-1),
  "aria-sort": token("ascending", "descending", "none", "other"),
  "aria-valuemax": number,
  "aria-valuemin": number,
  "aria-valuenow": number,
  "aria-valuetext": free,
};

/** The closest ARIA attribute name within two edits. */
export function nearestAriaAttribute(name: string): string | undefined {
  return nearest(name, Object.keys(ARIA_ATTRIBUTES));
}

/** Why a value is not valid for an attribute, or undefined when it is valid. Tokens compare without regard to case. */
export function ariaValueProblem(value: AriaValue, raw: string): { expected: string; caseOnly: boolean } | undefined {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const answer = (expected: string, allowed: readonly string[]) => ({ expected, caseOnly: allowed.includes(lower) });
  switch (value.kind) {
    case "free":
      return undefined;
    case "bool":
      return text === "true" || text === "false" ? undefined : answer('"true" or "false"', ["true", "false"]);
    case "bool?":
      return ["true", "false", "undefined"].includes(text) ? undefined : answer('"true", "false", or "undefined"', ["true", "false", "undefined"]);
    case "tristate":
      return ["true", "false", "mixed", "undefined"].includes(text) ? undefined : answer('"true", "false", "mixed", or "undefined"', ["true", "false", "mixed", "undefined"]);
    case "token":
      return value.values.includes(text) ? undefined : answer(value.values.map((v) => `"${v}"`).join(", "), value.values);
    case "tokens": {
      const parts = text.split(/\s+/).filter(Boolean);
      return parts.length > 0 && parts.every((p) => value.values.includes(p)) ? undefined : { expected: `a list of ${value.values.map((v) => `"${v}"`).join(", ")}`, caseOnly: false };
    }
    case "int":
      return /^[+-]?\d+$/.test(text) && Number.parseInt(text, 10) >= value.min ? undefined : { expected: `a whole number of ${value.min} or more`, caseOnly: false };
    case "number":
      return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? undefined : { expected: "a number", caseOnly: false };
  }
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}
