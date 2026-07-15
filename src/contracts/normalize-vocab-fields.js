import { createLookupNormalizer } from "./lookup-normalizer.js";
import { CONTRACT_STATUS_MAP, SPA_TIER_MAP, SUPPORT_MODE_MAP, PARTS_COVERAGE_MAP, YES_NO_SW_MAP } from "./vocab-maps.js";

export const normalizeContractStatus = createLookupNormalizer({
  map: CONTRACT_STATUS_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizeSpaTier = createLookupNormalizer({
  map: SPA_TIER_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizeSupportMode = createLookupNormalizer({
  map: SUPPORT_MODE_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizePartsCoverage = createLookupNormalizer({
  map: PARTS_COVERAGE_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizeHwRefresh = createLookupNormalizer({
  map: YES_NO_SW_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizeUpdates = createLookupNormalizer({
  map: YES_NO_SW_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});

export const normalizeUpgrades = createLookupNormalizer({
  map: YES_NO_SW_MAP,
  fallbackCode: "UNKNOWN",
  issueType: "UNMAPPED_ENUM_VALUE"
});
