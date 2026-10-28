// A tiny ANSI palette for human terminal output, with no dependencies.
// Color is used only when the stream is attached to a terminal, and
// `NO_COLOR` (https://no-color.org/) turns it off everywhere. Machine
// formats (`--format json`, `markdown`, `sarif`) and report files are
// never painted, wherever they are written.

export interface ColorEnvironment {
  /** stdout is an interactive terminal. */
  stdoutIsTTY: boolean;
  /** stderr is an interactive terminal. */
  stderrIsTTY: boolean;
  /** NO_COLOR was set to a non-empty value: keep every stream plain. */
  noColor: boolean;
}

/** Detection from the running process; callers that need to test inject a `ColorEnvironment` instead. */
export function detectColorEnvironment(): ColorEnvironment {
  return {
    stdoutIsTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    noColor: process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "",
  };
}

/** Wraps text for a severity or status: `error`, `warning`, `note`, or `ok` (clean). */
export type Paint = (text: string) => string;

export interface Palette {
  error: Paint;
  warning: Paint;
  note: Paint;
  ok: Paint;
}

const CODES: Record<keyof Palette, number> = { error: 31, warning: 33, note: 36, ok: 32 };
const reset = "\x1b[0m";

const paint = (code: number): Paint => (text) => `\x1b[${code}m${text}${reset}`;
const plainPaint: Paint = (text) => text;

/** Never paints; the default when the environment says not to. */
export const PLAIN: Palette = { error: plainPaint, warning: plainPaint, note: plainPaint, ok: plainPaint };

/** The palette for one stream, or `PLAIN` when that stream is not a terminal or NO_COLOR is set. */
export function paletteFor(color: ColorEnvironment | undefined, stream: "stdout" | "stderr"): Palette {
  if (color === undefined || color.noColor) return PLAIN;
  if (!(stream === "stdout" ? color.stdoutIsTTY : color.stderrIsTTY)) return PLAIN;
  return { error: paint(CODES.error), warning: paint(CODES.warning), note: paint(CODES.note), ok: paint(CODES.ok) };
}
