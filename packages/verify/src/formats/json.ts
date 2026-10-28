// JSON output: the versioned report itself, byte-identical across platforms. See report.ts.

import { reportToJson } from "../report.js";
import type { Formatter } from "./base.js";

export const render: Formatter = (report) => reportToJson(report);
