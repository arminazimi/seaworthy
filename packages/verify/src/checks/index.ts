// Built-in checks. Each check lives in its own file and is registered here, in ID order.

import type { Check } from "../types.js";
import { a11yAriaAttributes, a11yAriaReferences, a11yAriaRoles, a11yAutocomplete, a11yDuplicateId, a11yEmptyHeadings, a11yHiddenFocusable, a11yIframeTitle, a11yLandmarks, a11yLangParts, a11yMediaCaptions, a11yRadioGroups, a11ySkipLink, a11yTableHeaders, a11yTabindex } from "./a11y.js";
import { assetsMissing } from "./assets.js";
import { linksExternal } from "./external.js";
import { headingsH1, headingsOrder } from "./headings.js";
import { htmlCharset, htmlDoctype, htmlInlineHandlers, htmlNesting, htmlObsolete, htmlParseErrors } from "./html.js";
import { hostingHeaders, hostingRedirects } from "./hosting.js";
import { i18nHreflang } from "./i18n.js";
import { imagesAlt, imagesDimensions, imagesSize } from "./images.js";
import { linksBaseUrl, linksInternal } from "./links.js";
import { htmlMetaRefresh, htmlRedirectChain, metaCanonical, metaCanonicalCycle, metaCanonicalTarget, metaDescription, metaDuplicateDescription, metaDuplicateTitles, metaLang, metaTitle, metaViewport } from "./meta.js";
import { namesButton, namesLabel, namesLink } from "./names.js";
import { qualityEmptyPages, qualityNotFoundPage, qualityOrphans } from "./quality.js";
import { securityMixedContent, securityTargetBlank } from "./security.js";
import { robotsBlocksAll, robotsSitemap, sitemapEntries } from "./sitemap.js";
import { readabilityA2aCard, readabilityAgentSkills, readabilityAiRobots, readabilityApiCatalog, readabilityContentSignals, readabilityJsonld, readabilityLlmsTxt, readabilityMarkdownNegotiation, readabilityMcpCard, readabilityMdAlternates, readabilitySsrContent } from "./readability.js";
import { socialImageSize, socialImageUrl, socialOpenGraph, socialTwitterCard } from "./social.js";

export const builtInChecks: readonly Check[] = [
  a11yAriaAttributes,
  a11yAriaReferences,
  a11yAriaRoles,
  a11yAutocomplete,
  a11yDuplicateId,
  a11yEmptyHeadings,
  a11yHiddenFocusable,
  a11yIframeTitle,
  a11yLandmarks,
  a11yLangParts,
  a11yMediaCaptions,
  a11yRadioGroups,
  a11ySkipLink,
  a11yTableHeaders,
  a11yTabindex,
  assetsMissing,
  headingsH1,
  headingsOrder,
  hostingHeaders,
  hostingRedirects,
  htmlCharset,
  htmlInlineHandlers,
  htmlDoctype,
  htmlMetaRefresh,
  htmlNesting,
  htmlObsolete,
  htmlRedirectChain,
  htmlParseErrors,
  i18nHreflang,
  imagesAlt,
  imagesDimensions,
  imagesSize,
  linksBaseUrl,
  linksExternal,
  linksInternal,
  metaCanonical,
  metaCanonicalCycle,
  metaCanonicalTarget,
  metaDescription,
  metaDuplicateDescription,
  metaDuplicateTitles,
  metaLang,
  metaTitle,
  metaViewport,
  namesButton,
  namesLabel,
  namesLink,
  qualityEmptyPages,
  qualityNotFoundPage,
  qualityOrphans,
  readabilityA2aCard,
  readabilityAgentSkills,
  readabilityAiRobots,
  readabilityApiCatalog,
  readabilityContentSignals,
  readabilityJsonld,
  readabilityLlmsTxt,
  readabilityMarkdownNegotiation,
  readabilityMcpCard,
  readabilityMdAlternates,
  readabilitySsrContent,
  robotsBlocksAll,
  robotsSitemap,
  securityMixedContent,
  securityTargetBlank,
  sitemapEntries,
  socialImageSize,
  socialImageUrl,
  socialOpenGraph,
  socialTwitterCard,
];
