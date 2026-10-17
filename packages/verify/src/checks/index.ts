// Built-in checks. Each check lives in its own file and is registered here, in ID order.

import type { Check } from "../types.js";
import { assetsMissing } from "./assets.js";
import { linksExternal } from "./external.js";
import { linksBaseUrl, linksInternal } from "./links.js";

export const builtInChecks: readonly Check[] = [assetsMissing, linksBaseUrl, linksExternal, linksInternal];
