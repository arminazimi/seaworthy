// Tiny glob matcher for site-relative paths and check-ID patterns. Supports `*`, `**`, and `?`.

const cache = new Map<string, RegExp>();

/** `*` matches within one path segment, `**` across segments, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  // Site-relative paths always use forward slashes (site.ts normalizes them), so a glob
  // written on Windows with backslash separators must match the same paths.
  const pattern = glob.replace(/\\/g, "/");
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${out}$`);
  cache.set(glob, re);
  return re;
}

export function matchesGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/** Check-ID patterns: an exact ID, or a prefix ending in `.*` such as `a11y.*`. */
export function matchesCheck(pattern: string, id: string): boolean {
  return pattern.endsWith(".*") ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}
