// Helpers for checks that read files other than HTML (llms.txt, robots.txt, .well-known JSON).

import type { SiteGraph } from "../site.js";
import { readSiteFile } from "./helpers.js";

/** A site file's text, or undefined when the file is not in the site. A leading byte-order mark is removed. */
export function siteText(site: SiteGraph, urlPath: string): string | undefined {
  const text = readSiteFile(site, urlPath)?.bytes.toString("utf8");
  return text?.replace(/^﻿/, "");
}

/** Where in a text an index falls, as 1-based line and column. */
export function positionIn(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const line = before.split("\n").length;
  return { line, column: index - (before.lastIndexOf("\n") + 1) + 1 };
}

/** Parses JSON; on failure returns the message and the position it points at when the engine names one. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string; line?: number; column?: number } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const at = /position (\d+)/.exec(message);
    const where = at ? positionIn(text, Number(at[1])) : undefined;
    return { ok: false, message, ...(where ?? {}) };
  }
}

/** Whether text looks like an HTML document, which is what a server's "not found" fallback page usually is. */
export const looksLikeHtml = (text: string): boolean => /^\s*(<!doctype\s+html|<html[\s>])/i.test(text);

/** Where a JSON string value first appears at or after `from`, as the file position of its opening quote; line 1 when it is not found. */
export function locateJsonString(file: string, text: string, value: string, from = 0): { file: string; line: number; column: number } {
  const at = text.indexOf(JSON.stringify(value), from);
  return { file, ...positionIn(text, at < 0 ? 0 : at) };
}
