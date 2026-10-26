# html.obsolete

An element or presentational attribute is obsolete: browsers still render it, but the HTML Standard no longer allows it.

## Why it matters

Obsolete markup works today only because browsers keep a compatibility path for old pages. It is nonconforming HTML, so validators and tooling report it, and some of it (blinking and moving text, layout tables) hurts people who use screen readers, keyboard navigation, or reduced motion. Presentational attributes also cap how a page can adapt to small screens.

## What it checks

Elements the HTML Standard lists as obsolete: `acronym`, `applet`, `basefont`, `bgsound`, `big`, `blink`, `center`, `dir`, `font`, `frame`, `frameset`, `isindex`, `keygen`, `marquee`, `menuitem`, `nobr`, `noembed`, `noframes`, `param`, `plaintext`, `rb`, `rtc`, `spacer`, `strike`, `tt`, and `xmp`.

Presentational attributes, on the elements where the standard makes them obsolete: `align`, `bgcolor`, and `background` anywhere; `border` on images, objects, tables, and iframes; `cellpadding`, `cellspacing`, `rules`, and `summary` on tables; `valign`, `char`, and `charoff` on table cells and columns; `clear` on `br`; `compact` on lists; `color`, `noshade`, and `size` on `hr`; `frameborder`, `scrolling`, `marginheight`, and `marginwidth` on frames; `hspace` and `vspace` on embedded media; `language` on `script`; `alink`, `link`, `text`, and `vlink` on `body`; `version` on `html`; `nowrap` on cells; `rev` and `longdesc`; `axis` and `abbr` on cells; and `type` on `ul` and `li`.

The check reports one finding per obsolete element or attribute. An obsolete element's own attributes are not reported separately: `<font color="red">` is one finding, not two. Elements and attributes in the SVG namespace are ignored, because SVG has its own `<font>` and does not use these HTML attributes.

## How to fix

```html
<!-- before -->
<center><font color="red">Sale</font></center>
<table bgcolor="#eee" border="1">
  <tr><td align="center" valign="top">Total</td></tr>
</table>
<p align="center">Centered</p>

<!-- after -->
<div class="sale">Sale</div>
<table class="totals">
  <tr><td class="total">Total</td></tr>
</table>
<p class="centered">Centered</p>
```

```css
.sale { color: red; text-align: center; }
.totals { background: #eee; border: 1px solid #999; }
.totals .total { text-align: center; vertical-align: top; }
.centered { text-align: center; }
```

## Options

None.

## Standards

- [HTML Standard §16.2 Nonconforming features](https://html.spec.whatwg.org/multipage/obsolete.html#nonconforming-features)
