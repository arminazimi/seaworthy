// Built-in checks. Each check lives in its own file and is registered here, in ID order.

import type { Check } from "../types.js";
import { a11yDuplicateId, a11yEmptyHeadings, a11yTabindex } from "./a11y.js";
import { assetsMissing } from "./assets.js";
import { linksExternal } from "./external.js";
import { headingsH1, headingsOrder } from "./headings.js";
import { imagesAlt, imagesDimensions, imagesSize } from "./images.js";
import { linksBaseUrl, linksInternal } from "./links.js";
import { metaCanonical, metaDescription, metaLang, metaTitle, metaViewport } from "./meta.js";
import { namesButton, namesLabel, namesLink } from "./names.js";
import { securityMixedContent, securityTargetBlank } from "./security.js";
import { robotsBlocksAll, robotsSitemap, sitemapEntries } from "./sitemap.js";
import { socialImageUrl, socialOpenGraph } from "./social.js";

export const builtInChecks: readonly Check[] = [
  a11yDuplicateId,
  a11yEmptyHeadings,
  a11yTabindex,
  assetsMissing,
  headingsH1,
  headingsOrder,
  imagesAlt,
  imagesDimensions,
  imagesSize,
  linksBaseUrl,
  linksExternal,
  linksInternal,
  metaCanonical,
  metaDescription,
  metaLang,
  metaTitle,
  metaViewport,
  namesButton,
  namesLabel,
  namesLink,
  robotsBlocksAll,
  robotsSitemap,
  securityMixedContent,
  securityTargetBlank,
  sitemapEntries,
  socialImageUrl,
  socialOpenGraph,
];
