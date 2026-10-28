# quality.not-found-page

The build's not-found page is missing, or the file that stands in for it is not a real page.

## Why it matters

Every host serves one page for addresses that do not exist. On a static site that page has to be in the build: without it, people who follow a broken link or a stale URL land on the host's generic error page, with none of the site's navigation to bring them back. Agents that browse the site get a soft 404 too — a page that says nothing and sends no one home.

## What it checks

The build has a not-found page under a path static hosts and generators use: `404.html` at the site root, or `404/index.html`. It reports:

- **No 404 page**: neither path is in the built files.
- **Redirect stub**: the page's only content is a redirect (for example `<meta http-equiv="refresh">`). Hosts serve the 404 page with a 404 status, so a redirect from it can loop and hides the error from people and agents.
- **No content**: the page renders no visible text, the way an application placeholder does.

Pages that explain the missed address and link back pass.

## How to fix

Add a real not-found page at the site root as `404.html` (or `404/index.html`), the way a generator's "not found" template does:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page not found</title>
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>The address does not exist any more. Start from the <a href="/">home page</a>.</p>
  </main>
</body>
</html>
```

Remove the `<meta http-equiv="refresh">` redirect from it, and write the message into the page itself instead of an empty shell. Most static site generators make this a layout your configure once, not a page you hand-write.

## Options

None.

## Standards

None.
