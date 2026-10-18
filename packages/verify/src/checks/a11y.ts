// a11y.*: static accessibility rules that need no browser (epic E-a11y-static).

import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { ABSTRACT_ROLES, ALLOWED_ROLES, ARIA_ATTRIBUTES, ROLES, ariaValueProblem, nearest, nearestAriaAttribute, nearestRole } from "./aria-data.js";
import { AUTOFILL_FIELDS, autofillProblem } from "./autofill-data.js";
import { ancestors, check, descendants, documentLocation, firstElement, isHidden, isRedirectStub, locate, meta, pagesOf, renameAttribute, replaceAttribute, textOf } from "./helpers.js";

export const a11yTabindex = check(meta("a11y.tabindex", "Element has a positive tabindex, which breaks the focus order", "warning", ["WCAG 2.4.3"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      const raw = attr(element, "tabindex");
      if (raw === undefined || !/^\s*\+?\d+\s*$/.test(raw) || Number.parseInt(raw, 10) <= 0) continue;
      const location = locate(page, element, "tabindex");
      const edit = replaceAttribute(page, element, "tabindex", "0");
      out.push({
        message: `<${element.tagName}> has tabindex="${raw.trim()}". Keyboard focus visits it before everything else on the page, out of reading order.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: 'Use tabindex="0" to make an element focusable in its natural place, or remove tabindex from elements that are focusable already. Fix the order by moving the element in the HTML, not with positive numbers.',
          edits: edit ? [edit] : [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? raw.trim()}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** True when something inside the element gives it a name: text, an image with alt text, or an ARIA label. */
function hasAccessibleContent(element: Parameters<typeof textOf>[0]): boolean {
  if (textOf(element) || (attr(element, "aria-label") ?? "").trim() || (attr(element, "aria-labelledby") ?? "").trim()) return true;
  return descendants(element).some(
    (e) => ((e.tagName === "img" || e.tagName === "input") && (attr(e, "alt") ?? "").trim() !== "") || (attr(e, "aria-label") ?? "").trim() !== "" || (attr(e, "aria-labelledby") ?? "").trim() !== "",
  );
}

export const a11yEmptyHeadings = check(meta("a11y.empty-headings", "Heading has no text", "warning", ["WCAG 1.3.1", "WCAG 2.4.6"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      const isHeading = HEADING_TAGS.has(element.tagName) || attr(element, "role")?.trim().toLowerCase() === "heading";
      if (!isHeading || isHidden(element) || hasAccessibleContent(element)) continue;
      const location = locate(page, element);
      out.push({
        message: `<${element.tagName}> is a heading with no text. Screen reader users hear "heading" and nothing else, and it appears in their heading list as a blank entry.`,
        location,
        fix: {
          kind: "manual",
          summary: "Write the heading text, or remove the element if it is only there for spacing; use CSS margin or padding for space.",
          edits: [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? ""}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

export const a11yDuplicateId = check(meta("a11y.duplicate-id", "Page has the same id on more than one element", "warning", ["WCAG 1.3.1", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const first = new Map<string, { line: number | undefined; count: number }>();
    for (const element of page.elements) {
      const id = attr(element, "id");
      if (!id) continue;
      const location = locate(page, element, "id");
      const seen = first.get(id);
      if (!seen) {
        first.set(id, { line: location.line, count: 1 });
        continue;
      }
      seen.count += 1;
      out.push({
        message: `id="${id}" is already used by another element${seen.line ? ` on line ${seen.line}` : ""}. Links to #${id}, <label for>, and aria-labelledby or aria-describedby reach only the first one.`,
        location,
        fix: {
          kind: "manual",
          summary: `Give each element a unique id. Rename this one and every reference to it (href="#${id}", for="${id}", aria-*="${id}").`,
          edits: [],
        },
        key: `${id}:${seen.count}`,
      });
    }
  }
  return out;
});

const ID_REFERENCES = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-flowto", "aria-details", "aria-activedescendant", "aria-errormessage"] as const;

export const a11yAriaReferences = check(meta("a11y.aria-references", "ARIA attribute points at an id that does not exist", "error", ["WCAG 1.3.1", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      for (const name of ID_REFERENCES) {
        const raw = attr(element, name);
        if (raw === undefined) continue;
        const missing = raw.split(/\s+/).filter((id) => id !== "" && !page.ids.has(id));
        if (missing.length === 0) continue;
        const location = locate(page, element, name);
        out.push({
          message: `${name}="${raw.trim()}" on <${element.tagName}> points at ${missing.length === 1 ? "an id" : "ids"} that ${missing.length === 1 ? "does" : "do"} not exist on this page: ${missing.join(", ")}. Assistive technology ignores the reference.`,
          location,
          fix: {
            kind: "manual",
            summary: `Add an element with ${missing.length === 1 ? `id="${missing[0]}"` : "each missing id"}, or correct the reference to an id that exists on this page. For a name that is plain text, aria-label is simpler.`,
            edits: [],
          },
          key: `${name}:${missing.join(" ")}:${element.tagName}`,
        });
      }
    }
  }
  return out;
});

/** True for elements that a keyboard can reach: links with href, enabled form controls, and anything with tabindex of 0 or more. */
function isFocusable(element: Parameters<typeof attr>[0]): boolean {
  const tabindex = attr(element, "tabindex");
  if (tabindex !== undefined && /^\s*[+-]?\d+\s*$/.test(tabindex)) return Number.parseInt(tabindex, 10) >= 0;
  if (attr(element, "disabled") !== undefined && ["button", "input", "select", "textarea"].includes(element.tagName)) return false;
  if (element.tagName === "input") return attr(element, "type")?.trim().toLowerCase() !== "hidden";
  if (element.tagName === "a" || element.tagName === "area") return attr(element, "href") !== undefined;
  if (["button", "select", "textarea"].includes(element.tagName)) return true;
  if (element.tagName === "summary") return true;
  if (attr(element, "contenteditable") !== undefined && attr(element, "contenteditable")?.trim().toLowerCase() !== "false") return true;
  return false;
}

export const a11yHiddenFocusable = check(meta("a11y.hidden-focusable", "Focusable element is inside aria-hidden content", "error", ["WCAG 4.1.2", "WCAG 2.4.3"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (attr(element, "aria-hidden")?.trim().toLowerCase() !== "true") continue;
      // Report the aria-hidden element once, naming the first focusable thing it hides.
      const hidden = [element, ...descendants(element)].filter((e) => isFocusable(e) && ![e, ...ancestors(e)].some((a) => attr(a, "hidden") !== undefined || attr(a, "inert") !== undefined));
      const first = hidden[0];
      if (!first) continue;
      // A nested aria-hidden is covered by the outer one.
      const outer = ancestors(element).some((a) => attr(a, "aria-hidden")?.trim().toLowerCase() === "true");
      if (outer) continue;
      const location = locate(page, element, "aria-hidden");
      out.push({
        message: `aria-hidden="true" on <${element.tagName}> hides ${hidden.length === 1 ? "a focusable element" : `${hidden.length} focusable elements`} from screen readers, but keyboard focus can still reach ${hidden.length === 1 ? "it" : "them"}: <${first.tagName}>${first === element ? "" : " inside it"}. Users land on something they cannot hear.`,
        location,
        fix: {
          kind: "manual",
          summary: 'Remove aria-hidden="true" if the content is meant to be used. If it is decoration or an off-screen panel, make it unreachable too: add the hidden or inert attribute, or tabindex="-1" on each focusable element.',
          edits: [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? first.tagName}:${hidden.length}`,
      });
    }
  }
  return out;
});

export const a11yAriaRoles = check(meta("a11y.aria-roles", "role value is unknown, abstract, or not allowed on the element", "error", ["WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      const raw = attr(element, "role");
      if (raw === undefined) continue;
      const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const location = locate(page, element, "role");
      const used = tokens.find((t) => ROLES.has(t)); // the first token a browser understands is the one it uses
      if (!used) {
        const abstract = tokens.find((t) => ABSTRACT_ROLES.has(t));
        const guess = abstract ? undefined : nearestRole(tokens[0]!);
        out.push({
          message: abstract
            ? `role="${raw.trim()}" is an abstract role. Abstract roles are for the ARIA specification only and browsers ignore them.`
            : `role="${raw.trim()}" is not a role in WAI-ARIA 1.2, so browsers ignore it${guess ? `. Did you mean "${guess}"?` : "."}`,
          location,
          fix: {
            kind: "manual",
            summary: abstract ? "Use a concrete role such as button, region, or list, or remove the attribute." : `Use a role from WAI-ARIA 1.2${guess ? `, probably role="${guess}"` : ""}, or remove the attribute. A native element such as <button> or <nav> needs no role.`,
            edits: [],
          },
          key: `${element.tagName}:${tokens.join(" ")}`,
        });
        continue;
      }
      const allowed = ALLOWED_ROLES[element.tagName];
      if (allowed && !allowed.has(used)) {
        out.push({
          message: `role="${used}" is not allowed on <${element.tagName}>. Browsers may ignore it or announce the element wrongly.`,
          location,
          severity: "warning",
          fix: {
            kind: "manual",
            summary: `Use the native element for this role (for example <${used === "button" ? "button" : "a"}>), or put the role on a <div> or <span>. Allowed on <${element.tagName}>: ${[...allowed].join(", ")}.`,
            edits: [],
          },
          key: `${element.tagName}:${used}`,
        });
      }
    }
  }
  return out;
});

export const a11yAriaAttributes = check(meta("a11y.aria-attributes", "ARIA attribute does not exist or has an invalid value", "error", ["WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      for (const { name, value } of element.attrs) {
        if (!name.startsWith("aria-")) continue;
        const location = locate(page, element, name);
        const spec = ARIA_ATTRIBUTES[name];
        if (!spec) {
          const guess = nearestAriaAttribute(name);
          const edit = guess ? renameAttribute(page, element, name, guess) : undefined;
          out.push({
            message: `${name} is not a WAI-ARIA attribute, so assistive technology ignores it${guess ? `. Did you mean ${guess}?` : "."}`,
            location,
            fix: {
              kind: edit ? "edit" : "manual",
              summary: guess ? `Rename it to ${guess}, or remove it.` : "Use an aria-* attribute from WAI-ARIA 1.2, or remove it.",
              edits: edit ? [edit] : [],
            },
            key: `${element.tagName}:${name}`,
          });
          continue;
        }
        const problem = ariaValueProblem(spec, value);
        if (!problem) continue;
        const lowered = problem.caseOnly ? replaceAttribute(page, element, name, value.trim().toLowerCase()) : undefined;
        out.push({
          message: `${name}="${value}" is not a valid value. It must be ${problem.expected}.`,
          location,
          fix: {
            kind: lowered ? "edit" : "manual",
            summary: `Set ${name} to ${problem.expected}.`,
            edits: lowered ? [lowered] : [],
          },
          key: `${element.tagName}:${name}:${value.trim()}`,
        });
      }
    }
  }
  return out;
});

const looksValid = (tag: string): boolean => /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(tag) || /^x(-[a-z0-9]{1,8})+$/i.test(tag);

export const a11yLangParts = check(meta("a11y.lang-parts", "lang on an inner element is not a valid language code", "warning", ["WCAG 3.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName === "html") continue; // meta.lang reports the page language
      const raw = attr(element, "lang");
      const tag = raw?.trim();
      if (raw === undefined || tag === "" || (tag !== undefined && looksValid(tag))) continue;
      const location = locate(page, element, "lang");
      const dashed = tag!.replace(/_/g, "-");
      const edit = dashed !== tag && looksValid(dashed) ? replaceAttribute(page, element, "lang", dashed) : undefined;
      out.push({
        message: `lang="${raw}" on <${element.tagName}> is not a valid language code. Screen readers cannot switch to the right pronunciation for this text.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: `Use a BCP 47 language code such as "fr", "ar", or "pt-BR"${edit ? ` (underscores become hyphens: "${dashed}")` : ""}, or remove the attribute if the text is in the page language.`,
          edits: edit ? [edit] : [],
        },
        key: `${element.tagName}:${tag}`,
      });
    }
  }
  return out;
});

/** Input types that never take autofill: they hold no personal data the browser could fill. */
const NO_AUTOFILL_TYPES = new Set(["hidden", "checkbox", "radio", "file", "submit", "reset", "button", "image"]);

export const a11yAutocomplete = check(meta("a11y.autocomplete", "autocomplete value is not a valid autofill token", "warning", ["WCAG 1.3.5"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (!["input", "select", "textarea"].includes(element.tagName)) continue;
      if (element.tagName === "input" && NO_AUTOFILL_TYPES.has((attr(element, "type") ?? "text").trim().toLowerCase())) continue;
      const raw = attr(element, "autocomplete");
      if (raw === undefined) continue;
      const problem = autofillProblem(raw);
      if (!problem) continue;
      const location = locate(page, element, "autocomplete");
      const guess = problem.reason === "unknown" && problem.token ? nearest(problem.token, AUTOFILL_FIELDS) : undefined;
      const fixed = guess ? raw.trim().replace(new RegExp(`(^|\\s)${problem.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "i"), `$1${guess}`) : undefined;
      const edit = fixed ? replaceAttribute(page, element, "autocomplete", fixed) : undefined;
      const why = {
        unknown: `"${problem.token}" is not an autofill field name`,
        contact: `"${problem.token}" can only be used before tel, email, or impp fields`,
        mixed: `"${problem.token}" cannot be combined with other tokens`,
        order: `"${problem.token}" is in the wrong place`,
      }[problem.reason];
      out.push({
        message: `autocomplete="${raw}" is not valid: ${why}${guess ? `. Did you mean "${guess}"?` : "."} Browsers and assistive technology cannot fill this field.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: `Use "on", "off", or a field name from the HTML autofill list, such as "email", "given-name", "street-address", or "one-time-code", optionally after section-*, shipping or billing, and home, work, or mobile (for phone and email).`,
          edits: edit ? [edit] : [],
        },
        key: `${element.tagName}:${raw.trim().toLowerCase()}`,
      });
    }
  }
  return out;
});

export const a11yTableHeaders = check(meta("a11y.table-headers", "Data table has no header cells, or headers points at a cell that is not in it", "error", ["WCAG 1.3.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const tables = page.elements.filter((e) => e.tagName === "table");
    tables.forEach((table, index) => {
      if (isHidden(table)) return;
      const role = attr(table, "role")?.trim().toLowerCase();
      if (role === "presentation" || role === "none") return; // a layout table, by the author's own word
      const inside = descendants(table).filter((e) => !ancestorsBefore(e, table).some((a) => a.tagName === "table"));
      const rows = inside.filter((e) => e.tagName === "tr");
      const cells = inside.filter((e) => e.tagName === "td" || e.tagName === "th");
      const columns = Math.max(0, ...rows.map((row) => cells.filter((c) => c.parentNode === row).length));
      const name = attr(table, "id") ?? `table-${index + 1}`;
      if (rows.length >= 2 && columns >= 2 && !cells.some((c) => c.tagName === "th")) {
        out.push({
          message: `This table has ${rows.length} rows and ${columns} columns but no header cells (<th>). Screen reader users hear each value without knowing which column or row it belongs to.`,
          location: locate(page, table),
          fix: {
            kind: "manual",
            summary: 'Make the cells that label columns <th scope="col"> and the cells that label rows <th scope="row">. If the table is only for layout, use CSS grid or flexbox instead, or add role="presentation".',
            edits: [],
          },
          key: `${name}:no-header`,
        });
      }
      const ids = new Set(cells.map((c) => attr(c, "id")).filter((id): id is string => !!id));
      for (const cell of cells) {
        const raw = attr(cell, "headers");
        if (raw === undefined) continue;
        const missing = raw.split(/\s+/).filter((id) => id !== "" && !ids.has(id));
        if (missing.length === 0) continue;
        out.push({
          message: `headers="${raw.trim()}" points at ${missing.length === 1 ? "an id" : "ids"} that ${missing.length === 1 ? "is" : "are"} not on a cell of this table: ${missing.join(", ")}.`,
          location: locate(page, cell, "headers"),
          fix: {
            kind: "manual",
            summary: "Give each header cell this cell refers to an id, and list those ids in headers. Or drop headers and use scope on the <th> cells, which is enough for simple tables.",
            edits: [],
          },
          key: `${name}:${missing.join(" ")}`,
        });
      }
    });
  }
  return out;
});

/** The element's ancestors up to, but not including, the given one. */
function ancestorsBefore(element: Parameters<typeof ancestors>[0], stop: Parameters<typeof ancestors>[0]) {
  const chain = ancestors(element);
  const at = chain.indexOf(stop);
  return at === -1 ? chain : chain.slice(0, at);
}

/** The page's main landmarks that people can reach: `<main>` or role="main", not hidden. */
function mainLandmarks(page: ReturnType<typeof pagesOf>[number]) {
  return page.elements.filter((e) => (e.tagName === "main" || attr(e, "role")?.trim().toLowerCase() === "main") && !isHidden(e));
}

export const a11yLandmarks = check(meta("a11y.landmarks", "Page does not have exactly one main landmark", "warning", ["WCAG 1.3.1", "WCAG 2.4.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const body = firstElement(page, "body");
    if (!body || !textOf(body)) continue; // nothing to navigate
    const mains = mainLandmarks(page);
    if (mains.length === 0) {
      out.push({
        message: "The page has no <main> landmark. Screen reader users cannot jump straight to the content, and have to move through the header and navigation first.",
        location: documentLocation(page),
        fix: {
          kind: "manual",
          summary: "Wrap the page's primary content, the part that differs from page to page, in a single <main> element. Keep the site header, navigation, and footer outside it.",
          edits: [],
        },
        key: "missing",
      });
      continue;
    }
    mains.slice(1).forEach((extra, i) => {
      out.push({
        message: `The page has ${mains.length} visible main landmarks. A page has one main content area; the others make the landmark list ambiguous.`,
        location: locate(page, extra),
        fix: {
          kind: "manual",
          summary: "Keep one <main>. Change the others to <div> or <section>, or hide inactive ones with the hidden attribute (HTML allows several <main> elements only when all but one are hidden).",
          edits: [],
        },
        key: `extra:${i + 2}`,
      });
    });
  }
  return out;
});

type Element = ReturnType<typeof pagesOf>[number]["elements"][number];

/** True when an ancestor labels the group of controls: a fieldset with a legend, or a group/radiogroup with an ARIA name. */
function groupLabelled(input: Element): boolean {
  return ancestors(input).some((a) => {
    const named = (attr(a, "aria-label") ?? "").trim() !== "" || (attr(a, "aria-labelledby") ?? "").trim() !== "";
    if (a.tagName === "fieldset") {
      const legend = (a.childNodes as Element[]).find((c) => "tagName" in c && c.tagName === "legend");
      return named || (legend !== undefined && textOf(legend) !== "");
    }
    const role = attr(a, "role")?.trim().toLowerCase();
    return (role === "radiogroup" || role === "group") && named;
  });
}

export const a11yRadioGroups = check(meta("a11y.radio-groups", "Radio buttons or checkboxes that belong together have no group label", "error", ["WCAG 1.3.1", "WCAG 3.3.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const groups = new Map<string, Element[]>();
    for (const input of page.elements) {
      if (input.tagName !== "input" || isHidden(input)) continue;
      const type = (attr(input, "type") ?? "").trim().toLowerCase();
      const name = (attr(input, "name") ?? "").trim();
      if ((type !== "radio" && type !== "checkbox") || name === "") continue;
      const form = ancestors(input).find((a) => a.tagName === "form");
      const scope = form ? page.elements.indexOf(form) : -1;
      const key = `${scope}|${type}|${name}`;
      groups.set(key, [...(groups.get(key) ?? []), input]);
    }
    for (const inputs of groups.values()) {
      if (inputs.length < 2) continue;
      const bare = inputs.find((i) => !groupLabelled(i));
      if (!bare) continue;
      const type = (attr(bare, "type") ?? "").trim().toLowerCase();
      const name = attr(bare, "name")!.trim();
      out.push({
        message: `${inputs.length} ${type === "radio" ? "radio buttons" : "checkboxes"} named "${name}" form a group, but no <fieldset> with a <legend> (or a labelled group) names it. Screen reader users hear each option without the question it answers.`,
        location: locate(page, bare),
        fix: {
          kind: "manual",
          summary: `Wrap the options in <fieldset><legend>The question</legend> ... </fieldset>, or in an element with role="${type === "radio" ? "radiogroup" : "group"}" and an aria-labelledby that points at the question text.`,
          edits: [],
        },
        key: `${type}:${name}`,
      });
    }
  }
  return out;
});

export const a11yMediaCaptions = check(meta("a11y.media-captions", "Video has no captions, or media plays sound on its own", "error", ["WCAG 1.2.2", "WCAG 1.4.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName !== "video" && element.tagName !== "audio") continue;
      if (isHidden(element)) continue;
      const muted = attr(element, "muted") !== undefined;
      if (attr(element, "autoplay") !== undefined && !muted) {
        const location = locate(page, element, "autoplay");
        out.push({
          message: `<${element.tagName}> starts playing on its own with sound. People using a screen reader cannot hear their reader over it, and it cannot be stopped easily.`,
          location,
          fix: {
            kind: "manual",
            summary: "Remove autoplay so people start it themselves. For a silent background video, add muted (and loop and playsinline) as well, with no controls needed.",
            edits: [],
          },
          key: `${element.tagName}:autoplay:${attr(element, "src") ?? attr(element, "id") ?? ""}`,
        });
      }
      if (element.tagName !== "video" || muted) continue; // a muted video has no speech to caption
      const hasTrack = descendants(element).some((t) => t.tagName === "track" && ["captions", "subtitles"].includes((attr(t, "kind") ?? "subtitles").trim().toLowerCase()) && (attr(t, "src") ?? "").trim() !== "");
      if (hasTrack) continue;
      out.push({
        message: "This video has no captions track. People who are deaf or hard of hearing cannot follow what is said, and nobody can follow it with the sound off.",
        location: locate(page, element),
        fix: {
          kind: "manual",
          summary: 'Add a captions file: <track kind="captions" src="/video/talk.en.vtt" srclang="en" label="English">. If the video has no speech or sound that carries meaning, add the muted attribute.',
          edits: [],
        },
        key: `${element.tagName}:captions:${attr(element, "src") ?? attr(element, "id") ?? ""}`,
      });
    }
  }
  return out;
});

const startOf = (element: Element): number => element.sourceCodeLocation?.startOffset ?? Number.POSITIVE_INFINITY;
const SKIP_WORDS = /skip|jump|main|content/i;

export const a11ySkipLink = check(meta("a11y.skip-link", "Page has navigation before the main content but no working skip link", "warning", ["WCAG 2.4.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const main = mainLandmarks(page)[0];
    if (!main) continue; // a11y.landmarks reports a missing main
    const mainStart = startOf(main);
    const before = page.elements.filter((e) => startOf(e) < mainStart);
    const nav = before.find((e) => e.tagName === "nav" || attr(e, "role")?.trim().toLowerCase() === "navigation");
    const links = before.filter((e) => e.tagName === "a" && attr(e, "href") !== undefined);
    if (!nav || links.length < 3) continue; // a few links before the content are not worth skipping
    const early = links.slice(0, 2).filter((a) => attr(a, "href")!.startsWith("#") && attr(a, "href")!.length > 1);
    const working = early.some((a) => {
      const fragment = decodeURIComponent(attr(a, "href")!.slice(1));
      const target = page.elements.find((e) => attr(e, "id") === fragment || (e.tagName === "a" && attr(e, "name") === fragment));
      return target !== undefined && (target === main || ancestors(target).includes(main) || ancestors(main).includes(target));
    });
    if (working) continue;
    const intended = early.find((a) => SKIP_WORDS.test(`${textOf(a)} ${attr(a, "aria-label") ?? ""}`));
    out.push({
      message: intended
        ? `The skip link "${textOf(intended) || attr(intended, "aria-label")}" points at ${attr(intended, "href")}, which is not the main content: ${page.ids.has(decodeURIComponent(attr(intended, "href")!.slice(1))) ? "that element is outside <main>" : "no element has that id"}. Keyboard users who use it land nowhere useful.`
        : `The page has ${links.length} links before the main content and no skip link. Keyboard users must tab through all of them on every page.`,
      location: intended ? locate(page, intended, "href") : locate(page, nav),
      fix: {
        kind: "manual",
        summary: `Make the first link on the page <a class="skip-link" href="#main">Skip to main content</a>, give <main> the id "main", and style .skip-link to be hidden until it receives focus.`,
        edits: [],
      },
      key: intended ? `broken:${attr(intended, "href")}` : "missing",
    });
  }
  return out;
});
