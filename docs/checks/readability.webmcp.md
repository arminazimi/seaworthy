# readability.webmcp

**Experimental.** WebMCP is a draft spec running in a Chromium origin trial, so this check is a note and never an error, every finding says the standard is a draft, and the check is opt-in: it runs only under `--rendered`. On a browser that does not expose a WebMCP model context the check is reported as skipped, with a reason, rather than as passed.

Each tool a page registers through WebMCP has the name, description and input-schema shape the draft asks for, and the list an agent reads actually contains them.

## Why it matters

WebMCP lets a page hand an agent named, typed functions instead of making it drive the DOM: "search these docs" as a tool with a `query` string, rather than as a form the agent has to find, fill and submit. For an agent the page's tool list is the whole interface, in the same way a heading structure and a document outline are the whole interface for a crawler.

A registration that an agent cannot read is worse than no registration, because the page looks machine-ready and is not:

- an agent selects tools by their exact `name`, so a name with a space in it is a name that cannot be asked for.
- the `description` is the only thing an agent reads before deciding to call a tool, so a tool without one is a tool nobody finds.
- `inputSchema` is what the agent builds its arguments from; a schema that is not a JSON Schema object describing one object of arguments produces calls the page rejects.
- a list an agent cannot read at all, because the registration never reached it, because only a frame can see it, or because the listing throws, means the tools do not exist as far as the agent is concerned.

## What it checks

The check reads the tool list the page's own model context answers with. That list is what an agent sees, so it is what Seaworthy measures, and it is read as plain data: the name, whether a description is present, and the shape of `inputSchema`. Nothing is invoked. The draft separates listing a tool from running one (`executeTool` is its own method), and running a page-authored handler would execute untrusted code with side effects, which Seaworthy never does. A registration without an `execute` callback is refused by the browser, so a tool that lists at all has a handler: this check reports registration quality, never whether a handler answers.

For each rendered page:

- **The name** is 1 to 128 characters of ASCII letters, digits, `-`, `_` and `.`, and is text. A name that is too long, empty, or spelled with characters the draft does not allow is reported, with a name the page could paste instead.
- **The description** is present and not just whitespace.
- **`inputSchema`** is a JSON Schema object when it is given, and its top-level `type` is `"object"`. Leaving `inputSchema` out is fine: the draft makes it optional, and a tool that takes no arguments has nothing to describe.
- **Names are unique** within one page's list, counting a same-origin frame's list separately.
- **The list is reachable.** A note when the page's own source registers tools but its model context lists none once loaded; when the tools appear only inside a same-origin frame while the page itself lists none; and when asking the context for its tools threw instead of answering.

A page that registers nothing, and a page that only writes *about* WebMCP, is not reported: absence is not a defect, and prose is not a registration. To keep that honest, whether a page intends WebMCP is decided from its source (an inline script, a script file the built site serves, a `<tool>` element, or the frame document's own file), never from running the page.

One limit follows from reading the page the way an agent does: a page that hands out an object of its own under `document.modelContext` is read as a page with a model context, because an agent reading it sees exactly the same thing. Seaworthy cannot tell a polyfill from the real API, and does not try to; it reports what the list says.

Each finding is anchored on the script or `<tool>` element that carries the registration, in the built file, with a fix hint for the page's source.

**Rendered, offline, and opt-in.** Pages load from `file://` URLs, requests to remote `http(s)` resources are aborted, and the browser is the one already on the machine, launched as installed: Seaworthy never downloads a browser, never adds flags, and uses no network (ADR 0005). Every page is measured at phone (375 px), tablet (768 px) and desktop (1280 px); a registration reads the same at every width, so one problem stays one finding and names the widths it was seen at (`Seen at phone (375 px), tablet (768 px), desktop (1280 px).`). There is no broken fixture for it in the fixture gate for the same reason there is none for `a11y.axe`.

**What a machine needs to reproduce a positive result.** The report never names a browser version, so this is where the requirement lives. Today only Chromium builds carry WebMCP: the origin trial runs from Chrome 149 through Chrome 156, and the API first landed in Chrome 146 Canary. Because an origin trial token is bound to a registered `https` origin, and Seaworthy loads pages from `file://`, a token cannot enable it here; the reproducible route is a Chromium 146 or newer with `chrome://flags/#enable-webmcp-testing` turned on, launched by your own command line. Without that, expect this skip:

```json
{
  "check": "readability.webmcp",
  "reason": "webmcp-unsupported",
  "hint": "This browser exposes no WebMCP model context, so the page's tools cannot be read. …"
}
```

and the rest of this page then says what the check would have compared against, not what it found.

## How to fix

Fix the page's source, not the built file. The well-formed registration the finding is asking for:

```js
document.modelContext?.registerTool({
  name: "search-docs",
  description: "Search the documentation for a phrase. Returns matching pages with their URL and heading.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Words to search for" } },
    required: ["query"],
  },
  execute: async ({ query }) => ({ results: await search(query) }),
});
```

The three cases the finding names, each with its own hint:

- **Bad name**: rename with letters, digits, `-`, `_` and `.` only, 128 characters at most. The finding carries a pasteable suggestion, and an agent asks for this exact string.
- **No description**: write one sentence saying what the tool does and when to use it.
- **Schema that is not an object**: describe one object of arguments (`{ "type": "object", "properties": { … }, "required": [ … ] }`), and give each property a `description`, since the schema is the only documentation an agent gets before calling.
- **An empty or unreachable list**: register during load, not behind a click, a scroll, or data that arrives later, because an agent reads the tool list when the page finishes loading. Register on the top-level document you want the agent to open: a tool registered in an iframe is visible to an agent reading that frame's document, not the page that hosts it.

There is no automatic edit: Seaworthy cannot know what your tool does.

## Options

None of their own. The check needs a browser (`needs: ["html", "browser"]`), so it is off until you opt in with `--rendered`, `"rendered": true` in the config, or the MCP tool's `rendered` input. Which browser it launches follows the fixed order in [ADR 0005](../adr/0005-headless-browser.md): `--browser-path`, then `SEAWORTHY_BROWSER`, then a well-known Chrome, Chromium or Edge install. Seaworthy adds no command-line switches, so it cannot turn WebMCP on for you; see the requirement above.

## Standards

- [WebMCP](https://webmachinelearning.github.io/webmcp/) — the draft IDL this check reads: `readonly attribute ModelContext modelContext` on `Document` (older experimental builds put it on `navigator`), `registerTool(ModelContextTool)`, `getTools()` and `executeTool(RegisteredTool, inputObject)` on `ModelContext`, and the `ModelContextTool` dictionary (`name`, `title`, `description`, `inputSchema`, `annotations`, `execute`). The draft's name rule (1 to 128 ASCII letters, digits, `_`, `-`, `.`), its `InvalidStateError` for a duplicate or invalid registration, and its separation of listing from executing are what the notes above follow.
- [Join the WebMCP origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial) — Chrome 149 through Chrome 156, opened 2026-06-02, with `chrome://flags/#enable-webmcp-testing` for local testing without a token.
- [WebMCP on Chrome Platform Status](https://chromestatus.com/) — where the trial's dates and browser support are recorded.

Because the standard is a draft, a finding here is only a note, and details may change: when the draft moves, the check moves with it in a minor release and this page records the date.

- [Agent-readability spec](../../spec/agent-readability/v1.md)
