// Built-in checks. Each check lives in its own file and is registered here, in ID order.

import type { Check } from "../types.js";
import { assetsMissing } from "./assets.js";
import { linksExternal } from "./external.js";
import { headingsH1, headingsOrder } from "./headings.js";
import { linksBaseUrl, linksInternal } from "./links.js";
import { metaCanonical, metaDescription, metaLang, metaTitle, metaViewport } from "./meta.js";
import { socialImageUrl, socialOpenGraph } from "./social.js";

export const builtInChecks: readonly Check[] = [
  assetsMissing,
  headingsH1,
  headingsOrder,
  linksBaseUrl,
  linksExternal,
  linksInternal,
  metaCanonical,
  metaDescription,
  metaLang,
  metaTitle,
  metaViewport,
  socialImageUrl,
  socialOpenGraph,
];
