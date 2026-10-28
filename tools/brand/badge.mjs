// Seaworthy status badge. One source: the pure badge module in packages/action/src/badge-svg.ts,
// which needs nothing but Node builtins so the Action's `seaworthy-badge` CLI runs from an installed
// package with no Seaworthy checkout; this file re-exports it so tools/brand keeps working against
// the same artwork (BRAND_GUIDE.md). Requires the monorepo build first: `npm run build`.
export { badgeSvg, badgeForReport, README_SNIPPET, STATUS } from "../../packages/action/dist/src/badge-svg.js";
