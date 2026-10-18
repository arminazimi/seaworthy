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
  let best: { role: string; distance: number } | undefined;
  for (const role of ROLES) {
    const distance = editDistance(token, role);
    if (distance <= 2 && (!best || distance < best.distance)) best = { role, distance };
  }
  return best?.role;
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
