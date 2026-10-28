// Browser discovery for rendered checks (ADR 0005): Seaworthy never downloads a browser.
// A rendered check uses one that the machine already has, found in a fixed order:
// an explicit path (--browser-path or `ctx.browser.path`), then SEAWORTHY_BROWSER,
// then well-known Chrome, Chromium, and Edge installs on this platform.
// The path is input: it is checked for existence, never executed beyond launching through playwright-core.

import { existsSync, statSync } from "node:fs";

/** The browser a rendered check should launch. */
export interface DiscoveredBrowser {
  /** Absolute path of the browser executable. */
  readonly path: string;
  /** How the path was chosen, for hints and debug output. */
  readonly source: "given" | "env" | "well-known";
}

/**macOS installs. Chrome first: it is on managed runners and on most developer machines. */
const MAC_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

/** Linux installs: the Debian and Arch names the common distros and CI runners ship. */
const LINUX_PATHS = [
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

/** Windows installs. The standard `C:\Program Files` layout runners and installs use. */
const WINDOWS_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const wellKnownPaths = (): readonly string[] => {
  if (process.platform === "darwin") return MAC_PATHS;
  if (process.platform === "win32") return WINDOWS_PATHS;
  return LINUX_PATHS;
};

function usable(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Finds the browser to launch, or undefined when this machine has none. Throws on a given path that does not exist. */
export function findBrowser(explicitPath?: string): DiscoveredBrowser | undefined {
  const fromEnv = process.env["SEAWORTHY_BROWSER"];
  const envs = [explicitPath, fromEnv].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  for (const path of envs) {
    if (usable(path)) return { path, source: explicitPath !== undefined ? "given" : "env" };
    // The user asked for a specific browser and it is not there: that is a mistake to surface, not a silent fallback.
    throw new Error(`the browser given for rendered checks does not exist: ${path}`);
  }
  for (const path of wellKnownPaths()) {
    if (usable(path)) return { path, source: "well-known" };
  }
  return undefined;
}
