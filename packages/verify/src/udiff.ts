// Minimal unified diff over two full file contents: standard git-style output that
// `git apply` parses. Seaworthy only previews edits (it never writes files), so the
// diff is pure text: no index lines, no mode lines, and paths relative to the site root.

export function splitLines(content: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      out.push(content.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < content.length) out.push(content.slice(start));
  return out;
}

type Op = { kind: "same" | "del" | "add"; text: string; a: number; b: number };

/** Guards the O(n*m) LCS table; beyond it, the diff degrades to a whole-file replacement. */
const MAX_TABLE = 16_000_000;

/** Classic backtrack over an LCS table. A file pair larger than the guard diffs as replace-all. */
function opsFor(a: readonly string[], b: readonly string[]): Op[] {
  if (a.length * b.length > MAX_TABLE) return [...a.map((text, i) => ({ kind: "del" as const, text, a: i, b: 0 })), ...b.map((text, j) => ({ kind: "add" as const, text, a: 0, b: j }))];
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i]!, a: i, b: j });
      i++;
      j++;
    } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) {
      ops.push({ kind: "del", text: a[i]!, a: i, b: 0 });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j]!, a: 0, b: j });
      j++;
    }
  }
  for (; i < a.length; i++) ops.push({ kind: "del", text: a[i]!, a: i, b: 0 });
  for (; j < b.length; j++) ops.push({ kind: "add", text: b[j]!, a: 0, b: j });
  return ops;
}

interface Hunk {
  from: number; // first op index (inclusive)
  to: number; // last op index (exclusive)
}

/** Groups the changes into hunks, `context` identical lines around each, merged when they touch. */
function hunksFor(ops: readonly Op[], context: number): Hunk[] {
  const changed: number[] = [];
  for (const [index, op] of ops.entries()) if (op.kind !== "same") changed.push(index);
  if (changed.length === 0) return [];
  const first = changed[0];
  if (first === undefined) return [];
  const hunks: Hunk[] = [];
  let from = first;
  let last = first;
  for (let k = 1; k < changed.length; k++) {
    const at = changed[k]!;
    if (at - last - 1 > context * 2) {
      hunks.push({ from, to: last + 1 });
      from = at;
    }
    last = at;
  }
  hunks.push({ from, to: last + 1 });
  // Widen each hunk by the context, clamped at the ends, and merge any that now touch.
  const widened: Hunk[] = [];
  let start = Math.max(0, (hunks[0] as Hunk).from - context);
  let end = Math.min(ops.length, (hunks[0] as Hunk).to + context);
  for (const h of hunks.slice(1)) {
    const s = Math.max(0, h.from - context);
    const e = Math.min(ops.length, h.to + context);
    if (s <= end) {
      end = e;
    } else {
      widened.push({ from: start, to: end });
      start = s;
      end = e;
    }
  }
  widened.push({ from: start, to: end });
  return widened;
}

/** Standard unified diff of two file contents, or "" when they are identical. */
export function unifiedDiff(a: string, b: string, file: string, context = 3): string {
  if (a === b) return "";
  const aLines = splitLines(a);
  const bLines = splitLines(b);
  const noEol = (lines: readonly string[]): boolean => lines.length > 0 && !lines[lines.length - 1]!.endsWith("\n");
  const ops = opsFor(aLines, bLines);
  const hunks = hunksFor(ops, context);
  const marker = "\\ No newline at end of file\n";
  const out: string[] = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  for (const hunk of hunks) {
    const body = ops.slice(hunk.from, hunk.to);
    const firstA = body.find((op) => op.kind !== "add");
    const firstB = body.find((op) => op.kind !== "del");
    const aCount = body.filter((op) => op.kind !== "add").length;
    const bCount = body.filter((op) => op.kind !== "del").length;
    // An empty side names the line it sits after (0 at the very start of the file).
    const priorA = ops.slice(0, hunk.from).filter((op) => op.kind !== "add").length;
    const priorB = ops.slice(0, hunk.from).filter((op) => op.kind !== "del").length;
    const aStart = aCount > 0 && firstA ? firstA.a + 1 : priorA;
    const bStart = bCount > 0 && firstB ? firstB.b + 1 : priorB;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of body) {
      const sign = op.kind === "same" ? " " : op.kind === "del" ? "-" : "+";
      const bare = op.text.endsWith("\n") ? op.text.slice(0, -1) : op.text;
      const noEnd = noEol(aLines) && op.kind !== "add" && op.a === aLines.length - 1;
      const noStart = noEol(bLines) && op.kind !== "del" && op.b === bLines.length - 1;
      out.push(sign + bare);
      if (noEnd || noStart) out.push("\\ No newline at end of file");
    }
  }
  return out.join("\n") + "\n";
}
