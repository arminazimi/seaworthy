// Parses ROADMAP.md into phases, epics, and tasks.
// The format is the one ROADMAP.md uses: a phase table, `# Phase N — Title (dates)` sections,
// `## Epic: Title` blocks with a roadmap-key marker, and a `### Tasks` table per epic.

const PHASE_ROW = /^\|\s*(Phase \d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;
const PHASE_HEADING = /^# (Phase \d+) — /;
const EPIC_HEADING = /^## Epic: (.+)$/;
const KEY_MARKER = /<!--\s*seaworthy-roadmap-key:\s*(\S+)\s*-->/;
const SECTION_HEADING = /^### (.+)$/;
const TASK_ROW = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*$/;

const stripBold = (s) => s.replace(/\*\*/g, "").trim();

/** Removes fenced code blocks (``` or ````) so examples inside them are never parsed as roadmap items. */
function withoutFences(lines) {
  const out = [];
  let fence = null;
  for (const line of lines) {
    const m = line.match(/^(`{3,})/);
    if (m) {
      if (fence === null) fence = m[1];
      else if (m[1].length >= fence.length) fence = null;
      out.push("");
      continue;
    }
    out.push(fence === null ? line : "");
  }
  return out;
}

function parseDeps(cell) {
  if (/^none$/i.test(cell.trim())) return [];
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * @param {string} markdown
 * @returns {{ phases: Array<{id:string,start:string,end:string,title:string,release:string}>,
 *             epics: Array<object>, tasks: Array<object>, errors: string[] }}
 */
export function parseRoadmap(markdown) {
  const lines = withoutFences(markdown.split(/\r?\n/));
  const phases = [];
  const epics = [];
  const tasks = [];
  const errors = [];

  let phase = null; // id of the `# Phase N` section we are in
  let epic = null;
  let section = null;

  const finishEpic = () => {
    if (!epic) return;
    if (!epic.key) errors.push(`epic "${epic.title}" has no roadmap-key marker`);
    epics.push(epic);
    epic = null;
    section = null;
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    const row = line.match(PHASE_ROW);
    if (row && !phases.some((p) => p.id === row[1])) {
      phases.push({ id: row[1], start: row[2], end: row[3], title: stripBold(row[4]), release: stripBold(row[5]) });
      return;
    }

    if (line.startsWith("# ")) {
      finishEpic();
      const m = line.match(PHASE_HEADING);
      phase = m ? m[1] : null;
      return;
    }

    const epicHeading = line.match(EPIC_HEADING);
    if (epicHeading) {
      finishEpic();
      if (!phase) {
        errors.push(`line ${lineNo}: epic "${epicHeading[1]}" is outside a "# Phase N" section`);
        return;
      }
      epic = { kind: "epic", key: null, title: epicHeading[1].trim(), phase, track: null, header: "", outcome: [], scope: [], nonGoals: [], exit: [], line: lineNo };
      return;
    }

    if (line.startsWith("## ")) {
      finishEpic();
      return;
    }

    if (!epic) return;

    const marker = line.match(KEY_MARKER);
    if (marker && !epic.key) {
      epic.key = marker[1];
      return;
    }
    if (line.startsWith("> **Epic**")) {
      epic.header = line.replace(/^>\s*/, "");
      const track = line.match(/\*\*Track:\*\*\s*(\w+)/);
      if (track) epic.track = track[1];
      return;
    }

    const heading = line.match(SECTION_HEADING);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      return;
    }

    const text = line.trim();
    if (!text || text === "---") return;

    switch (section) {
      case "outcome":
        epic.outcome.push(text);
        break;
      case "scope":
        if (text.startsWith("- ")) epic.scope.push(text.slice(2));
        break;
      case "non-goals":
        if (text.startsWith("- ")) epic.nonGoals.push(text.slice(2));
        break;
      case "exit criteria":
        if (text.startsWith("- [ ] ")) epic.exit.push(text.slice(6));
        break;
      case "tasks": {
        const t = text.match(TASK_ROW);
        if (t) {
          tasks.push({ kind: "task", key: t[1], title: t[2], lane: t[3], size: t[4], deps: parseDeps(t[5]), epic: epic.key, phase: epic.phase, track: epic.track, line: lineNo });
        } else if (text.startsWith("|") && !/^\|\s*(Key|---)/.test(text)) {
          errors.push(`line ${lineNo}: task row does not match "| \`key\` | Task | Lane | Size | Depends |"`);
        }
        break;
      }
      default:
        break;
    }
  });
  finishEpic();

  // Tasks were read before their epic's key was always known; re-link by position.
  for (const task of tasks) {
    if (!task.epic) {
      const owner = [...epics].reverse().find((e) => e.line < task.line);
      task.epic = owner?.key ?? null;
      task.track = owner?.track ?? null;
    }
  }

  return { phases, epics: epics.map((e) => ({ ...e, outcome: e.outcome.join(" ") })), tasks, errors };
}
