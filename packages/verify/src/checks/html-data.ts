// Obsolete elements and presentational attributes from the HTML Standard, section 16.2 (nonconforming features):
// https://html.spec.whatwg.org/multipage/obsolete.html#nonconforming-features
// Each entry says what to use instead, so the finding carries a fix an agent can apply.

/** Element name to the CSS or HTML replacement. */
export const OBSOLETE_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["acronym", 'Use <abbr title="...">, which screen readers understand.'],
  ["applet", "Use <object> or <embed> for embedded content."],
  ["basefont", "Set the font with CSS on <html> or <body>."],
  ["bgsound", "Use <audio> for background sound."],
  ["big", "Use CSS font-size."],
  ["blink", "Remove the blinking; moving or flashing text distracts and can trigger vestibular symptoms."],
  ["center", "Center content with CSS, using text-align: center or margin-inline: auto."],
  ["dir", "Use <ul> for a list."],
  ["font", "Use CSS font-family, font-size, and color instead of <font>."],
  ["frame", "Use a normal page layout; <iframe> when content really must be embedded."],
  ["frameset", "Use a normal page layout; <iframe> when content really must be embedded."],
  ["isindex", "Use a <form> with a labelled <input>."],
  ["keygen", "Use a modern credential flow, or an <input> with the right autocomplete token."],
  ["marquee", "Remove the moving text, or use a CSS animation that people can stop."],
  ["menuitem", "Use links or buttons inside <menu> or <ul>."],
  ["nobr", "Use CSS white-space: nowrap."],
  ["noembed", "Put fallback content inside <object> or <video>."],
  ["noframes", "Provide the content directly; frames are obsolete."],
  ["param", "Put the value on the <object> element or in the resource it loads."],
  ["plaintext", "Remove <plaintext>; it stops HTML parsing for the rest of the file."],
  ["rb", "Use ruby text with <rt>; an explicit base annotation is obsolete."],
  ["rtc", "Use <rt> for the ruby text."],
  ["spacer", "Use CSS margin or padding for space."],
  ["strike", "Use <s> for text that was removed, or CSS text-decoration: line-through."],
  ["tt", "Use CSS font-family: monospace, or <code> for code."],
  ["xmp", "Use <pre><code> and escape the markup."],
]);

export interface ObsoleteAttribute {
  /** Elements the attribute is obsolete on, or "all" when no element accepts it. */
  readonly elements: ReadonlySet<string> | "all";
  /** What to use instead, in the fix hint. */
  readonly replacement: string;
}

const set = (...names: string[]): ReadonlySet<string> => new Set(names);
const CELLS = set("td", "th");
const TABLE_PARTS = set("col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr");
const FRAMES = set("frame", "iframe");
const LISTS = set("dl", "menu", "ol", "ul");
const MEDIA = set("embed", "iframe", "img", "object");

/** Attribute name to the elements it is obsolete on and the CSS replacement. */
export const OBSOLETE_ATTRIBUTES: ReadonlyMap<string, ObsoleteAttribute> = new Map([
  ["align", { elements: "all", replacement: "Use CSS text-align, vertical-align, or margin-inline." }],
  ["bgcolor", { elements: "all", replacement: "Use CSS background-color." }],
  ["background", { elements: "all", replacement: "Use CSS background-image." }],
  ["border", { elements: set("iframe", "img", "object", "table"), replacement: "Use CSS border." }],
  ["cellpadding", { elements: set("table"), replacement: "Use CSS padding on the cells." }],
  ["cellspacing", { elements: set("table"), replacement: "Use CSS border-spacing on the table." }],
  ["char", { elements: TABLE_PARTS, replacement: "Use CSS text-align." }],
  ["charoff", { elements: TABLE_PARTS, replacement: "Use CSS text-align." }],
  ["clear", { elements: set("br"), replacement: "Use CSS clear." }],
  ["compact", { elements: LISTS, replacement: "Use CSS padding and margins to set the list spacing." }],
  ["color", { elements: set("hr"), replacement: "Use CSS border-color or background-color." }],
  ["frameborder", { elements: FRAMES, replacement: "Use CSS border: 0." }],
  ["hspace", { elements: MEDIA, replacement: "Use CSS margin." }],
  ["vspace", { elements: MEDIA, replacement: "Use CSS margin." }],
  ["language", { elements: set("script"), replacement: 'Use type="text/javascript" or omit type for a classic script.' }],
  ["alink", { elements: set("body"), replacement: "Use CSS :active." }],
  ["link", { elements: set("body"), replacement: "Use CSS :link or a stylesheet." }],
  ["text", { elements: set("body"), replacement: "Use CSS color." }],
  ["vlink", { elements: set("body"), replacement: "Use CSS :visited." }],
  ["longdesc", { elements: set("iframe", "img"), replacement: "Put the description in normal text near the element and link to it." }],
  ["marginheight", { elements: FRAMES, replacement: "Use CSS margin." }],
  ["marginwidth", { elements: FRAMES, replacement: "Use CSS margin." }],
  ["noshade", { elements: set("hr"), replacement: "Use CSS border." }],
  ["nowrap", { elements: CELLS, replacement: "Use CSS white-space: nowrap." }],
  ["rev", { elements: set("a", "link"), replacement: "Use rel with the matching link type." }],
  ["rules", { elements: set("table"), replacement: "Use CSS borders on the cells." }],
  ["scrolling", { elements: FRAMES, replacement: "Use CSS overflow." }],
  ["size", { elements: set("hr"), replacement: "Use CSS height or border-width." }],
  ["summary", { elements: set("table"), replacement: "Use a <caption> to describe the table." }],
  ["valign", { elements: TABLE_PARTS, replacement: "Use CSS vertical-align." }],
  ["version", { elements: set("html"), replacement: "Remove it; <!doctype html> declares the document type." }],
  ["abbr", { elements: CELLS, replacement: "Put the abbreviation in the cell text or a header." }],
  ["axis", { elements: CELLS, replacement: "Describe the cell with a header and its text." }],
  ["type", { elements: set("li", "ul"), replacement: "Use CSS list-style-type." }],
]);
