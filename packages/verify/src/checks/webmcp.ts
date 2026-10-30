// readability.webmcp: are the agent tools a page registers through WebMCP well formed, and can an
// agent reach them at all?
//
// WebMCP (a draft, in a Chromium origin trial) lets a page hand an agent named, typed functions
// instead of making it drive the DOM. An agent's entire view of those tools is the list the page's own
// model context answers with, so that list is what this check reads: each registration's name,
// description and input-schema shape, and whether the list is reachable from the page the agent opened.
//
// Nothing is invoked. The draft separates listing a tool from running one, and running a page-authored
// handler would execute untrusted code with its own side effects, which the repository's trust rules
// forbid; a registration without a handler is refused by the browser, so a tool that lists at all has
// one. Seaworthy therefore reports registration quality, never whether a handler answers.
//
// Rendered and opt-in like a11y.axe (ADR 0005): pages load from `file://` URLs, requests to remote
// `http(s)` resources are aborted, and a browser that does not expose a model context skips the check
// instead of passing it. The report never names a browser version; what a machine needs to reproduce a
// positive result is written down in docs/checks/readability.webmcp.md.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { findBrowser } from "../browser.js";
import { launchBrowser, openContext, probeRendered, VIEWPORTS, viewportLabel, type PlaywrightBrowser, type Viewport } from "../render.js";
import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { Check, CheckContext, FindingDraft, Location, ProbeSkip } from "../types.js";
import { documentLocation, locate, meta, pagesOf, readSiteFile, textOf } from "./helpers.js";

/** How a page says it registers tools: the API under either name the drafts use, or the declarative tool form. */
const REGISTRATION = /(?:modelContext|registerTool|application\/vnd\.agent\.tool)/i;

/** WebMCP tool names: 1 to 128 characters of ASCII letters, digits, `_`, `-` and `.`. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

const registersIn = (text: string): boolean => REGISTRATION.test(text);

/**
 * The text of the built site file a `src` points at, or `""` when it leaves the site or is not there:
 * a page that loads its tools from a CDN is not something this offline check can read.
 */
function pointedText(site: SiteGraph, pageUrl: string, href: string): string {
  const target = site.resolveLink(pageUrl, href);
  if (target.kind !== "internal" || target.file === undefined) return "";
  return readSiteFile(site, target.file)?.bytes.toString("utf8") ?? "";
}

/**
 * A name the page could use instead: the same words spelled the way the draft allows, so the hint is
 * pasteable rather than a description of what to paste.
 */
function suggestedName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 128);
  return cleaned === "" ? "my-tool" : cleaned;
}

export interface WebMcpAnchor {
  readonly element: HtmlElement;
  /** Where the claim to register lives: this page's own script, a `<tool>` element, or a frame's document. */
  readonly kind: "script" | "tool" | "frame";
}

/**
 * The source elements that claim a WebMCP registration, in document order: a script of this page (inline
 * or a file the built site serves) that uses the API, a `<tool>` element, or the iframe whose own file
 * does. Only script and tool content counts, so a page that merely writes *about* WebMCP in prose is not
 * read as a page that registers tools. These elements are where this check's findings are anchored.
 */
export function registrationAnchors(site: SiteGraph, page: Page): WebMcpAnchor[] {
  const out: WebMcpAnchor[] = [];
  for (const element of page.elements) {
    const src = (attr(element, "src") ?? "").trim();
    if (element.tagName === "script") {
      if (src === "") {
        if (registersIn(textOf(element))) out.push({ element, kind: "script" });
      } else if (registersIn(pointedText(site, page.url, src))) {
        out.push({ element, kind: "script" });
      }
    } else if (element.tagName === "tool") {
      out.push({ element, kind: "tool" });
    } else if (element.tagName === "iframe" && src !== "" && registersIn(pointedText(site, page.url, src))) {
      out.push({ element, kind: "frame" });
    }
  }
  return out;
}

/** One registration as the listing answers it, copied into plain data: nothing here is a live page object. */
export interface WebMcpToolShape {
  /** `"page"` for the list the page itself answers, `"frame"` for a same-origin frame's list. */
  readonly scope: string;
  /** `typeof` the recorded name, so a name that is not text is reported as what it is. */
  readonly nameType: string;
  /** The name, cut at one past the draft's 128-character maximum, or `""` when it is not text. */
  readonly name: string;
  readonly hasDescription: boolean;
  /** `"missing"`, `"object"`, `"array"` or `"other"`: what kind of value the recorded `inputSchema` is. */
  readonly schemaKind: string;
  /** The schema's own top-level `type`, `""` when it declares none or declares one that is not text. */
  readonly schemaType: string;
}

/** What one page had to say about its tools when a browser read it. */
export interface WebMcpObservation {
  /** True when this browser exposes a WebMCP model context on the page at all. */
  readonly supported: boolean;
  /** True when that context answers with a listing Seaworthy knows how to read. */
  readonly readable: boolean;
  /** True when asking that context for its tool list answered rather than throwing. */
  readonly listed: boolean;
  readonly tools: readonly WebMcpToolShape[];
}

export interface WebMcpProblem {
  /** Stable identity of the problem: a tool name or a page-level subject, never a position that moves. */
  readonly key: string;
  readonly message: string;
  readonly fix: string;
}

/** Every way one registration is malformed: its name, its description, and the schema an agent builds arguments from. */
export function toolProblems(tool: WebMcpToolShape, position: number): WebMcpProblem[] {
  const out: WebMcpProblem[] = [];
  const named = tool.nameType === "string" && tool.name !== "";
  const subject = tool.scope === "frame" ? "a frame of this page" : "this page";
  const label = named ? `the tool "${tool.name}"` : `a tool listed by ${subject} at position ${position + 1}`;
  const id = named ? tool.name : `#${position + 1}`;

  if (tool.nameType !== "string") {
    out.push({
      key: `name-type:${id}`,
      message: `A tool listed by ${subject} has a name that is not text.`,
      fix: "Give the registration a name as a plain string in the page's source.",
    });
  } else if (!TOOL_NAME.test(tool.name)) {
    const reason = tool.name.trim() === "" ? "is empty" : tool.name.length > 128 ? "is longer than the 128 characters the draft allows" : "uses characters WebMCP names do not allow";
    out.push({
      key: `name:${id}`,
      message: `A tool listed by ${subject} has the name "${tool.name}", which ${reason}. A WebMCP name is 1 to 128 characters of ASCII letters, digits, "-", "_" and ".".`,
      fix: `Rename it in the page's source to something like "${suggestedName(tool.name)}". An agent asks for a tool by this exact name.`,
    });
  }
  if (!tool.hasDescription) {
    out.push({
      key: `description:${id}`,
      message: `${label} has no description.`,
      fix: "Describe in one sentence what the tool does and when to use it, in the page's source. The description is the only thing an agent reads before deciding to call a tool, so a tool without one is a tool nobody finds.",
    });
  }
  if (tool.schemaKind === "array" || tool.schemaKind === "other") {
    out.push({
      key: `schema:${id}`,
      message: `${label} records an inputSchema that is ${tool.schemaKind === "array" ? "an array" : "not an object"}, not a JSON Schema object.`,
      fix: "Write inputSchema as a JSON Schema object describing one object of arguments, for example { \"type\": \"object\", \"properties\": { \"query\": { \"type\": \"string\" } }, \"required\": [ \"query\" ] }.",
    });
  } else if (tool.schemaKind === "object" && tool.schemaType !== "object") {
    out.push({
      key: `schema-type:${id}`,
      message: tool.schemaType === "" ? `${label} has an inputSchema that declares no top-level "type", so an agent cannot tell what to send.` : `${label} has an inputSchema whose top-level type is "${tool.schemaType}". A tool is called with one JSON object of arguments, so its schema should describe an object.`,
      fix: 'Give the inputSchema "type": "object" at the top level, with the arguments under "properties".',
    });
  }
  return out;
}

/**
 * What the agent could not use, from one page's observation: the listing that did not answer, the tools
 * only a frame can see, the registration that never reached the list, then each malformed entry in listing
 * order and each repeated name in sorted order.
 */
export function webMcpProblems(observed: WebMcpObservation, registers: boolean): WebMcpProblem[] {
  // Nothing to say when the browser has no WebMCP, or answers with a surface this check does not know how
  // to read: those are the probe's skip, never a note about the page.
  if (!observed.supported || !observed.readable) return [];
  const out: WebMcpProblem[] = [];
  const inPage = observed.tools.filter((tool) => tool.scope !== "frame");
  const inFrames = observed.tools.filter((tool) => tool.scope === "frame");

  if (!observed.listed) {
    out.push({
      key: "list-unavailable",
      message: "The page exposes a WebMCP model context, but asking it for its tools did not answer, so an agent gets no tool list from the page.",
      fix: "Check the browser console for the error the listing threw. A registration that the page's own model context cannot list is a registration no agent can use.",
    });
  } else if (inPage.length === 0 && inFrames.length > 0) {
    out.push({
      key: "frame-only",
      message: `The page's own model context lists no tools: its ${inFrames.length} tool${inFrames.length === 1 ? "" : "s"} appear only in a same-origin frame. An agent that opens this page, and not the frame, gets nothing.`,
      fix: "Register the tools on the top-level page's model context, or point the agent at the frame's own document URL.",
    });
  } else if (observed.tools.length === 0 && registers) {
    out.push({
      key: "no-registrations",
      message: "This page's source registers WebMCP tools, but its model context lists none once the page has loaded, so an agent gets no tools from it.",
      fix: "Register during load, not behind a click, a scroll, or data that arrives later: an agent reads the tool list the moment the page finishes loading. If the registration is in a module that never runs, or threw, the tools are not there either.",
    });
  }

  observed.tools.forEach((tool, position) => out.push(...toolProblems(tool, position)));

  const names = new Map<string, number>();
  for (const tool of observed.tools) {
    if (tool.nameType === "string" && tool.name !== "" && TOOL_NAME.test(tool.name)) names.set(`${tool.scope}\u0000${tool.name}`, (names.get(`${tool.scope}\u0000${tool.name}`) ?? 0) + 1);
  }
  for (const [scopeAndName, count] of [...names].sort()) {
    if (count < 2) continue;
    const name = scopeAndName.split("\u0000")[1] ?? "";
    const subject = scopeAndName.startsWith("frame") ? "a frame of this page" : "this page";
    out.push({
      key: `duplicate:${name}`,
      message: `${name} is listed ${count} times among the tools of ${subject}. An agent that asks for ${name} cannot tell which one runs.`,
      fix: "Give each tool one name. The draft says a second registration under a name already taken is refused, so a list that repeats it is a list an agent cannot act on.",
    });
  }
  return out;
}

/** One line for the report: what an agent cannot use, the widths it was seen at, and that this is a draft. */
export function problemMessage(problem: WebMcpProblem, widths: readonly Viewport[]): string {
  return `${problem.message} Seen at ${viewportLabel(widths)}. WebMCP is a draft standard in a Chromium origin trial, so Seaworthy reports this as a note, not an error.`;
}

/** One page, one problem, seen at one or more widths: the same merging the other rendered check does. */
export interface MergedWebMcpProblem {
  readonly file: string;
  readonly problem: WebMcpProblem;
  readonly location: Location;
  widths: Viewport[];
}

export function addProblem(problems: Map<string, MergedWebMcpProblem>, seen: { file: string; problem: WebMcpProblem; location: Location; viewport: Viewport }): void {
  const id = JSON.stringify([seen.file, seen.problem.key]);
  const known = problems.get(id);
  if (known === undefined) problems.set(id, { file: seen.file, problem: seen.problem, location: seen.location, widths: [seen.viewport] });
  else known.widths.push(seen.viewport);
}

/**
 * Where to report this page's WebMCP problem: the script or `<tool>` element that claims the
 * registration, and the document when the claim comes from somewhere this check cannot anchor.
 */
export function anchorOf(page: Page, anchors: readonly WebMcpAnchor[]): Location {
  const own = anchors.find((anchor) => anchor.kind !== "frame");
  const at = own?.element ?? anchors[0]?.element;
  return at ? locate(page, at) : documentLocation(page);
}

/**
 * Runs in the browser page and returns plain JSON. It reads the tool list the page's own model context
 * answers with, plus every same-origin frame's, and copies only the fields a registration is specified
 * to carry. Handlers are never called, and nothing the page holds travels back beyond these short fields.
 */
const readTools = async (): Promise<WebMcpObservation> => {
  type Holder = Record<string, unknown>;
  const isObject = (value: unknown): value is Holder => typeof value === "object" && value !== null;
  // Reading a cross-origin frame throws rather than returning nothing, so every property read is guarded.
  const field = (holder: unknown, name: string): unknown => {
    if (!isObject(holder)) return undefined;
    try {
      return (holder as Holder)[name];
    } catch {
      return undefined;
    }
  };
  const cut = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
  const contextIn = (holder: unknown): Holder | undefined => {
    for (const name of ["modelContext", "modelContextTesting"]) {
      const value = field(holder, name);
      if (isObject(value)) return value;
    }
    return undefined;
  };
  /** The draft puts the context on the Document; the builds before it, and the testing surface, put it on the Navigator. */
  const contextOf = (source: unknown): Holder | undefined => contextIn(source) ?? contextIn(field(source, "document")) ?? contextIn(field(source, "navigator"));
  /**
   * `readable` says this context answers with a listing Seaworthy knows how to read; `listed` says asking
   * it answered at all. A context with neither shape is this check not knowing the surface, not the page's
   * problem, so it never produces a finding.
   */
  const listFrom = async (context: Holder | undefined): Promise<{ readable: boolean; ok: boolean; tools: unknown[] }> => {
    if (context === undefined) return { readable: false, ok: false, tools: [] };
    const getter = field(context, "getTools") ?? field(context, "getToolDefinitions");
    if (typeof getter !== "function") return { readable: false, ok: false, tools: [] };
    try {
      const listed = await (getter as (this: Holder) => Promise<unknown>).call(context);
      return { readable: true, ok: true, tools: Array.isArray(listed) ? listed : [] };
    } catch {
      return { readable: true, ok: false, tools: [] };
    }
  };
  const shapeOf = (record: unknown, scope: string): WebMcpToolShape => {
    const tool = isObject(record) ? record : {};
    const schema = field(tool, "inputSchema");
    const declared = isObject(schema) && !Array.isArray(schema) ? schema : {};
    const description = field(tool, "description");
    return {
      scope,
      nameType: typeof field(tool, "name"),
      // Cut one past the draft's 128-character maximum, so a name that is too long is still seen to be too long.
      name: cut(field(tool, "name"), 129),
      hasDescription: typeof description === "string" && description.trim() !== "",
      schemaKind: schema === undefined || schema === null ? "missing" : Array.isArray(schema) ? "array" : isObject(schema) ? "object" : "other",
      schemaType: cut(field(declared, "type"), 40),
    };
  };

  const root = globalThis as unknown as Holder;
  const own = contextOf(root);
  if (own === undefined) return { supported: false, readable: false, listed: false, tools: [] };
  const listed = await listFrom(own);
  const tools = listed.tools.map((tool) => shapeOf(tool, "page"));
  const document = field(root, "document");
  const queryAll = field(document, "querySelectorAll");
  if (typeof queryAll === "function") {
    let frames: unknown[] = [];
    try {
      frames = Array.from((queryAll as (this: unknown, selector: string) => ArrayLike<unknown>).call(document, "iframe"));
    } catch {
      frames = [];
    }
    for (const frame of frames) {
      const context = contextOf(field(frame, "contentWindow")) ?? contextOf(field(frame, "contentDocument"));
      if (context === undefined || context === own) continue;
      const fromFrame = await listFrom(context);
      if (!fromFrame.ok) continue; // a frame the page cannot reach is not this page's fault to explain
      for (const tool of fromFrame.tools) tools.push(shapeOf(tool, "frame"));
    }
  }
  return { supported: true, readable: listed.readable, listed: listed.ok, tools };
};

/**
 * Why this check cannot say anything on this machine. A browser that does not expose a model context
 * cannot reproduce a positive result at all, and a context that answers with a surface this check does not
 * know how to read is the same problem in a different shape. Both are reported as skipped with the hint of
 * what would make the check run, never as passed: silence from a browser that has no WebMCP means nothing.
 */
export async function probeWebMcp(context: CheckContext): Promise<ProbeSkip | undefined> {
  const rendered = await probeRendered(context);
  if (rendered !== undefined) return rendered;
  const pages = pagesOf(context);
  if (pages.length === 0) return undefined; // nothing to read; the run reports nothing
  let browser: PlaywrightBrowser | undefined;
  let surface: "unreadable" | "absent" = "absent";
  try {
    const found = findBrowser(context.browser?.path);
    if (found === undefined) return { reason: "browser-unavailable", hint: "Install Chrome, Chromium, or Edge, or set SEAWORTHY_BROWSER to a browser executable, then run again with --rendered." };
    browser = await launchBrowser(found.path);
    const pwContext = await openContext(browser, VIEWPORTS[0]!);
    const pwPage = await pwContext.newPage();
    try {
      await pwPage.goto(pathToFileURL(join(context.site.root, pages[0]!.file)).href, { waitUntil: "load" });
      const observed = await pwPage.evaluate<WebMcpObservation>(readTools, undefined);
      if (observed.supported && observed.readable) return undefined;
      if (observed.supported) surface = "unreadable";
    } finally {
      await pwPage.close().catch(() => {});
    }
  } catch {
    return undefined; // the run reports what actually went wrong
  } finally {
    await browser?.close().catch(() => {});
  }
  return surface === "unreadable"
    ? {
        reason: "webmcp-surface-unknown",
        hint: "This browser exposes a WebMCP model context that does not answer with a tool list Seaworthy can read, so no page's tools can be checked against it. See docs/checks/readability.webmcp.md.",
      }
    : {
        reason: "webmcp-unsupported",
        hint: "This browser exposes no WebMCP model context, so the page's tools cannot be read. Seaworthy launches the browser as installed and adds no flags: run WebMCP locally with Chromium 146 or newer and chrome://flags/#enable-webmcp-testing enabled (the origin trial itself runs Chrome 149-156 and is bound to a registered https origin, which a file:// page cannot have). See docs/checks/readability.webmcp.md.",
      };
}

export const readabilityWebMcp: Check = {
  meta: meta("readability.webmcp", "A WebMCP tool registration is malformed or unreachable to an agent", "note", ["WebMCP (draft, Chromium origin trial)"], ["html", "browser"]),
  probe: probeWebMcp,
  async *run(context) {
    // The engine probes first, so by the time run is called a browser that can do WebMCP exists.
    const found = findBrowser(context.browser?.path);
    if (found === undefined) throw new Error("readability.webmcp found no browser to launch; next time the engine's probe would skip it");
    const browser = await launchBrowser(found.path);
    // One entry per problem, not per width: a registration reads the same at every width, and one that
    // only appears at some widths names the ones it was seen at.
    const merged = new Map<string, MergedWebMcpProblem>();
    const anchors = new Map<string, readonly WebMcpAnchor[]>();
    try {
      for (const viewport of VIEWPORTS) {
        const pwContext = await openContext(browser, viewport);
        try {
          for (const page of pagesOf(context)) {
            if (context.signal.aborted) break;
            const pwPage = await pwContext.newPage();
            try {
              await pwPage.goto(pathToFileURL(join(context.site.root, page.file)).href, { waitUntil: "load" });
              const observed = await pwPage.evaluate<WebMcpObservation>(readTools, undefined);
              // The probe already skipped a browser that cannot do this; a page that answers with something
              // else still must not be read as a page with no tools.
              if (!observed.supported || !observed.readable) continue;
              let at = anchors.get(page.file);
              if (at === undefined) {
                at = registrationAnchors(context.site, page);
                anchors.set(page.file, at);
              }
              const location = anchorOf(page, at);
              for (const problem of webMcpProblems(observed, at.some((anchor) => anchor.kind !== "frame"))) {
                addProblem(merged, { file: page.file, problem, location, viewport });
              }
            } finally {
              await pwPage.close().catch(() => {});
            }
          }
        } finally {
          await pwContext.close().catch(() => {});
        }
        if (context.signal.aborted) break;
      }
    } finally {
      await browser.close().catch(() => {});
    }
    for (const { problem, location, widths } of merged.values()) {
      yield {
        message: problemMessage(problem, widths),
        location,
        fix: { kind: "manual", summary: problem.fix, edits: [] },
        key: problem.key,
      } satisfies FindingDraft;
    }
  },
};
