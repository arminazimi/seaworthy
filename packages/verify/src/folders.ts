// The built-site folder: where a build usually writes, and how a report names it.
// Shared by the CLI and the MCP server, so both find and label a site the same way.

import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

/** Folders a build usually writes to, in the order they are tried when no folder is given. */
export const DEFAULT_FOLDERS = ["dist", "build", "out", "public", "_site", "site"] as const;

/** The folder as a relative label, so reports never contain absolute paths. */
export function rootLabel(cwd: string, folder: string): string {
  const rel = relative(cwd, folder);
  if (rel === "") return ".";
  if (isAbsolute(rel)) return basename(folder); // a different drive on Windows
  return rel.split("\\").join("/");
}

/** The first default folder that exists in `cwd`, or undefined when the site was not built. */
export function discoverFolder(cwd: string): string | undefined {
  return DEFAULT_FOLDERS.find((name) => {
    const folder = resolve(cwd, name);
    return existsSync(folder) && statSync(folder).isDirectory();
  });
}
