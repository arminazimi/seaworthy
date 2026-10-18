import assert from "node:assert/strict";
import { test } from "node:test";

import { a11yAriaAttributes, a11yAriaReferences, a11yAriaRoles, a11yAutocomplete, a11yDuplicateId, a11yEmptyHeadings, a11yHiddenFocusable, a11yIframeTitle, a11yLandmarks, a11yLangParts, a11yMediaCaptions, a11yRadioGroups, a11ySkipLink, a11yTableHeaders, a11yTabindex } from "../src/checks/a11y.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;

async function findings(body: string) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yTabindex] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("a11y.tabindex flags only whole numbers above zero", async () => {
  const lines = ['<a href="/" tabindex="1">a</a>', '<b tabindex="0">b</b>', '<b tabindex="-1">c</b>', '<b tabindex=" 7 ">d</b>', '<b tabindex="+2">e</b>', '<b tabindex="1.5">f</b>', '<b tabindex="">g</b>', "<b>h</b>"];
  assert.deepEqual((await findings(lines.join("\n"))).map((f) => f.location.line), [4, 7, 8]);
});

test("a11y.tabindex proposes tabindex=\"0\", keeping the quote style", async () => {
  const [double, single] = await findings(`<button tabindex="3">a</button>\n<button tabindex='4'>b</button>`);
  assert.deepEqual(double!.fix.edits.map((e) => [e.find, e.replace]), [['tabindex="3"', 'tabindex="0"']]);
  assert.deepEqual(single!.fix.edits.map((e) => [e.find, e.replace]), [["tabindex='4'", "tabindex='0'"]]);
  assert.equal(double!.severity, "warning");
});

test("a11y.iframe-title reports absent and blank titles without fetching embedded content", async () => {
  const body = [
    '<iframe src="https://example.invalid/map"></iframe>',
    '<iframe title=""></iframe>',
    '<iframe title=" &#32; "></iframe>',
    '<iframe title="Office location map"></iframe>',
    '<iframe title=" Video player "></iframe>',
    '<div title=""></div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yIframeTitle] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6]);
  for (const finding of result.findings) {
    assert.equal(finding.checkId, "a11y.iframe-title");
    assert.equal(finding.severity, "error");
    assert.equal(finding.fix.kind, "manual");
    assert.deepEqual(finding.fix.edits, []);
    assert.match(finding.fix.summary, /title/);
  }
});

test("a11y.iframe-title accepts accessible names and skips hidden or presentational frames", async () => {
  const body = [
    '<iframe aria-label="Office map"></iframe>',
    '<iframe title=" " aria-label="Video player"></iframe>',
    '<span id="map-label">Office <b>map</b></span>',
    '<iframe aria-labelledby="map-label"></iframe>',
    '<iframe aria-labelledby="missing map-label"></iframe>',
    '<iframe hidden></iframe>',
    '<iframe aria-hidden="true"></iframe>',
    '<iframe role="presentation"></iframe>',
    '<iframe role="none"></iframe>',
    '<div hidden><iframe></iframe></div>',
    '<div aria-hidden="true"><iframe></iframe></div>',
    '<iframe aria-label=" "></iframe>',
    '<iframe aria-labelledby="missing"></iframe>',
    '<span id="blank-label"> </span>',
    '<iframe aria-labelledby="blank-label"></iframe>',
    '<iframe aria-labelledby=" "></iframe>',
    '<iframe aria-hidden="false"></iframe>',
    '<iframe role="region"></iframe>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yIframeTitle] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [15, 16, 18, 19, 20, 21]);
});

test("a11y.empty-headings flags headings with no text, name, or labelled content", async () => {
  const body = [
    "<h2></h2>",
    "<h3>   </h3>",
    '<h2><span class="icon"></span></h2>',
    '<div role="heading" aria-level="2"></div>',
    "<h2>Text</h2>",
    '<h2><img src="/a.png" alt="Logo"></h2>',
    '<h2><img src="/a.png" alt=""></h2>',
    '<h2 aria-label="Named"></h2>',
    '<h2 aria-labelledby="x"></h2>',
    "<h2 hidden></h2>",
    '<div aria-hidden="true"><h2></h2></div>',
    "<h2><!-- note --></h2>",
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yEmptyHeadings] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 7, 10, 15]);
  assert.ok(result.findings.every((f) => f.severity === "warning" && f.fix.kind === "manual" && f.fix.edits.length === 0));
});

test("a11y.duplicate-id reports every repeat after the first, per page", async () => {
  const page = (body: string) => PAGE(body);
  const site = makeSite({
    "index.html": page('<p id="a">1</p>\n<p id="b">2</p>\n<p id="a">3</p>\n<p id="a">4</p>\n<p id="">5</p>\n<p id="">6</p>\n<svg id="b"></svg>'),
    "other.html": page('<p id="a">other page</p>'),
  });
  const result = await runChecks({ site: buildSite(site), checks: [a11yDuplicateId] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.file, f.location.line, f.location.column]), [["index.html", 6, 4], ["index.html", 7, 4], ["index.html", 10, 6]]);
  assert.match(result.findings[0]!.message, /id="a" is already used .* on line 4/);
  const keys = result.findings.map((f) => f.fingerprint);
  assert.equal(new Set(keys).size, 3, "each repeat has its own fingerprint");
});

test("a11y.aria-references reports ids that are not on the page and keeps the ones that are", async () => {
  const body = [
    '<h2 id="t">Title</h2>',
    '<div aria-labelledby="t">ok</div>',
    '<div aria-labelledby="t missing">partly</div>',
    '<div aria-describedby="nope">no</div>',
    '<button aria-controls="panel other">x</button>',
    '<div aria-labelledby="">empty</div>',
    '<div aria-labelledby="  t  ">spaces</div>',
    '<a name="legacy"></a><div aria-details="legacy">named anchor</div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yAriaReferences] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.line, f.location.column]), [[6, 6], [7, 6], [8, 9]]);
  assert.match(result.findings[0]!.message, /: missing\./);
  assert.match(result.findings[2]!.message, /panel, other/);
  assert.ok(result.findings.every((f) => f.severity === "error" && f.fix.kind === "manual"));
});

test("a11y.hidden-focusable reports aria-hidden content a keyboard can still reach", async () => {
  const body = [
    '<div aria-hidden="true"><a href="/x">link</a></div>',
    '<button aria-hidden="true">self</button>',
    '<div aria-hidden="true"><a href="/x">a</a><button>b</button></div>',
    '<div aria-hidden="true"><a href="/x" tabindex="-1">out of the tab order</a></div>',
    '<div aria-hidden="true"><button disabled>off</button><a>no href</a><span>text</span></div>',
    '<div aria-hidden="true"><div aria-hidden="true"><input></div></div>',
    '<div aria-hidden="true"><div hidden><a href="/x">hidden</a></div></div>',
    '<span aria-hidden="true" tabindex="0">icon</span>',
    '<div aria-hidden="false"><a href="/x">visible</a></div>',
    '<div aria-hidden="true"><input type="hidden"></div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yHiddenFocusable] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 9, 11]);
  assert.match(result.findings[2]!.message, /hides 2 focusable elements/);
  assert.ok(result.findings.every((f) => f.severity === "error" && f.fix.kind === "manual"));
});

test("a11y.aria-roles flags unknown and abstract roles and roles HTML does not allow on the element", async () => {
  const body = [
    '<div role="buton">typo</div>',
    '<div role="widget">abstract</div>',
    '<div role="button">fine</div>',
    '<div role="foo button">fallback to a known role</div>',
    '<div role="BUTTON">case does not matter</div>',
    '<h2 role="button">not allowed</h2>',
    '<nav role="navigation">implicit</nav>',
    '<ul role="menu"><li role="menuitem">ok</li></ul>',
    '<li role="button">no</li>',
    '<div role="doc-toc">module role</div>',
    '<div role="">empty</div>',
    '<span role="img" aria-label="x"></span>',
    '<button role="tab">ok</button>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yAriaRoles] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.line, f.severity]), [[4, "error"], [5, "error"], [9, "warning"], [12, "warning"]]);
  assert.match(result.findings[0]!.message, /Did you mean "button"\?/);
  assert.match(result.findings[1]!.message, /abstract role/);
});

test("a11y.aria-attributes flags unknown names and invalid values, with exact edits for typos and casing", async () => {
  const body = [
    '<div aria-lable="Save">typo</div>',
    '<div aria-foo="1">unknown</div>',
    '<button aria-expanded="True">case</button>',
    '<button aria-expanded="yes">word</button>',
    '<button aria-expanded="">empty</button>',
    '<div aria-live="loud">token</div>',
    '<div role="heading" aria-level="0">int</div>',
    '<div role="heading" aria-level="2">ok</div>',
    '<div role="slider" aria-valuenow="1.5" aria-valuemin="0" aria-valuemax="x">num</div>',
    '<div aria-relevant="additions text">ok</div>',
    '<div aria-relevant="additions bogus">tokens</div>',
    '<button aria-pressed="mixed" aria-current="page" aria-label="">ok</button>',
    '<div ARIA-HIDDEN="true">uppercase name</div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yAriaAttributes] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 7, 8, 9, 10, 12, 14]);
  const edits = result.findings.map((f) => f.fix.edits.map((e) => [e.find, e.replace]));
  assert.deepEqual(edits[0], [["aria-lable=", "aria-label="]]);
  assert.deepEqual(edits[1], []);
  assert.deepEqual(edits[2], [['aria-expanded="True"', 'aria-expanded="true"']]);
  assert.deepEqual(edits[3], [], "yes is ambiguous, so there is no edit");
  assert.match(result.findings[0]!.message, /Did you mean aria-label\?/);
});

test("a11y.lang-parts flags invalid codes on inner elements and fixes underscores", async () => {
  const body = [
    '<p lang="fr">ok</p>',
    '<p lang="pt-BR">ok</p>',
    '<p lang="zh-Hant-TW">ok</p>',
    '<p lang="x-klingon">private use</p>',
    '<p lang="">unknown language is allowed</p>',
    '<p lang="english">name</p>',
    '<p lang="en_US">underscore</p>',
    '<p lang="e">short</p>',
    '<p lang="en-">trailing hyphen</p>',
    '<p lang="x">alone</p>',
    '<p>none</p>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yLangParts] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [9, 10, 11, 12, 13]);
  assert.deepEqual(result.findings[1]!.fix.edits.map((e) => [e.find, e.replace]), [['lang="en_US"', 'lang="en-US"']]);
  assert.deepEqual(result.findings[0]!.fix.edits, []);
  assert.ok(result.findings.every((f) => f.severity === "warning"));
});

test("a11y.autocomplete accepts the autofill grammar and flags everything else", async () => {
  const body = [
    '<input autocomplete="email">',
    '<input autocomplete="off">',
    '<input autocomplete="section-blue shipping home tel webauthn">',
    '<input autocomplete="billing street-address">',
    '<input autocomplete="given-nme">',
    '<input autocomplete="firstname">',
    '<input autocomplete="work postal-code">',
    '<input autocomplete="on email">',
    '<input autocomplete="shipping section-a name">',
    '<input autocomplete="">',
    '<input type="hidden" autocomplete="nonsense">',
    '<select autocomplete="country"></select>',
    '<textarea autocomplete="nope"></textarea>',
    '<input autocomplete="Email">',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yAutocomplete] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [8, 9, 10, 11, 12, 13, 16]);
  assert.deepEqual(result.findings[0]!.fix.edits.map((e) => [e.find, e.replace]), [['autocomplete="given-nme"', 'autocomplete="given-name"']]);
  assert.deepEqual(result.findings[1]!.fix.edits, [], "firstname is not close enough to guess");
  assert.match(result.findings[2]!.message, /only be used before tel, email, or impp/);
  assert.match(result.findings[3]!.message, /cannot be combined/);
  assert.match(result.findings[4]!.message, /wrong place/);
});

test("a11y.table-headers flags data tables without header cells and headers that point nowhere", async () => {
  const body = [
    "<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>",
    "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
    '<table role="presentation"><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>',
    "<table><tr><td>only one row</td><td>x</td></tr></table>",
    "<table><tr><td>a</td></tr><tr><td>one column</td></tr></table>",
    "<table hidden><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>",
    '<table><tr><th id="h1">a</th><th id="h2">b</th></tr><tr><td headers="h1">1</td><td headers="h2 h3">2</td></tr></table>',
    "<table><tr><th>outer</th><td><table><tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr></table></td></tr></table>",
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yTableHeaders] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 10, 11]);
  assert.match(result.findings[0]!.message, /2 rows and 2 columns/);
  assert.match(result.findings[1]!.message, /h3/);
  assert.match(result.findings[2]!.message, /^This table has 2 rows/, "the nested table is judged on its own cells");
});

test("a11y.landmarks wants one visible main on every page that has content", async () => {
  const page = (body: string) => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;
  const site = makeSite({
    "none.html": page("<h1>No main</h1>"),
    "one.html": page("<main><h1>One</h1></main>"),
    "role.html": page('<div role="main"><h1>Role</h1></div>'),
    "two.html": page("<main><h1>One</h1></main>\n<main><h1>Two</h1></main>"),
    "hidden.html": page("<main><h1>One</h1></main>\n<main hidden><h1>Inactive</h1></main>"),
    "redirect.html": '<!doctype html><html lang="en"><head><title>r</title><meta http-equiv="refresh" content="0; url=/one.html"></head><body>Redirecting</body></html>',
    "empty.html": page("   "),
  });
  const result = await runChecks({ site: buildSite(site), checks: [a11yLandmarks] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.file, f.location.line]), [["none.html", 2], ["two.html", 5]]);
  assert.match(result.findings[0]!.message, /no <main> landmark/);
  assert.match(result.findings[1]!.message, /2 visible main landmarks/);
});

test("a11y.radio-groups needs a fieldset legend or a labelled group around controls that share a name", async () => {
  const body = [
    '<input type="radio" name="size" id="s"><input type="radio" name="size" id="m">',
    '<fieldset><legend>Colour</legend><input type="radio" name="colour"><input type="radio" name="colour"></fieldset>',
    '<fieldset><input type="checkbox" name="topic"><input type="checkbox" name="topic"></fieldset>',
    '<div role="radiogroup" aria-labelledby="q"><input type="radio" name="plan"><input type="radio" name="plan"></div>',
    '<div role="group"><input type="checkbox" name="extras"><input type="checkbox" name="extras"></div>',
    '<input type="radio" name="single">',
    '<input type="checkbox" name="solo"><input type="checkbox" name="other">',
    '<form><input type="radio" name="size"></form><form><input type="radio" name="size"></form>',
    '<fieldset><legend> </legend><input type="radio" name="blank"><input type="radio" name="blank"></fieldset>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yRadioGroups] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 6, 8, 12]);
  assert.match(result.findings[0]!.message, /2 radio buttons named "size"/);
  assert.match(result.findings[1]!.message, /2 checkboxes named "topic"/);
});

test("a11y.media-captions wants captions on sound video and no autoplay with sound", async () => {
  const body = [
    '<video src="/a.mp4" controls></video>',
    '<video controls><source src="/b.mp4"><track kind="captions" src="/b.vtt" srclang="en"></video>',
    '<video controls><track kind="subtitles" src="/b.vtt" srclang="fr"></video>',
    '<video controls><track kind="descriptions" src="/d.vtt"></video>',
    '<video controls><track kind="captions"></video>',
    '<video src="/loop.mp4" autoplay muted loop playsinline></video>',
    '<video src="/e.mp4" autoplay controls><track kind="captions" src="/e.vtt"></video>',
    '<audio src="/a.mp3" autoplay></audio>',
    '<audio src="/a.mp3" controls></audio>',
    '<video src="/h.mp4" hidden></video>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yMediaCaptions] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 7, 8, 10, 11]);
  assert.match(result.findings[3]!.message, /starts playing on its own/);
  assert.ok(result.findings.every((f) => f.severity === "error" && f.fix.kind === "manual"));
});

test("a11y.skip-link wants an early link that reaches the main content when navigation comes first", async () => {
  const page = (body: string) => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;
  const nav = '<nav><a href="/a">A</a> <a href="/b">B</a> <a href="/c">C</a></nav>';
  const site = makeSite({
    "good.html": page(`<a href="#main">Skip to main content</a>\n${nav}\n<main id="main"><h1>x</h1></main>`),
    "wrapper.html": page(`<a href="#content">Skip</a>\n${nav}\n<div id="content"><main><h1>x</h1></main></div>`),
    "inside.html": page(`<a href="#top">Skip to content</a>\n${nav}\n<main><h1 id="top">x</h1></main>`),
    "missing.html": page(`${nav}\n<main><h1>x</h1></main>`),
    "dead.html": page(`<a href="#gone">Skip to content</a>\n${nav}\n<main><h1>x</h1></main>`),
    "outside.html": page(`<a href="#menu">Skip to content</a>\n<nav id="menu"><a href="/a">A</a> <a href="/b">B</a></nav>\n<main><h1>x</h1></main>`),
    "late.html": page(`<nav><a href="/a">A</a> <a href="/b">B</a> <a href="/c">C</a></nav>\n<a href="#main">Skip to main</a>\n<main id="main"><h1>x</h1></main>`),
    "short.html": page('<nav><a href="/a">A</a> <a href="/b">B</a></nav>\n<main><h1>x</h1></main>'),
    "nomain.html": page(nav),
  });
  const result = await runChecks({ site: buildSite(site), checks: [a11ySkipLink] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.file), ["dead.html", "late.html", "missing.html", "outside.html"]);
  assert.match(result.findings[0]!.message, /no element has that id/);
  assert.match(result.findings[3]!.message, /outside <main>/);
  assert.match(result.findings[2]!.message, /3 links before the main content/);
});
