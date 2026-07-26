import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverviewEmpty, isQualityEmpty, isCrossingEmpty, isReportsEmpty } from "../../lib/fieldbeat-tab-empty-predicates.ts";
import type { FieldbeatOverviewResponse, FieldbeatQualityResponse } from "../../types/fieldbeat-quality.ts";
import type { FieldbeatCrossingResponse } from "../../types/fieldbeat-crossings.ts";
import type { FieldbeatReportsResponse } from "../../types/fieldbeat-reports.ts";

function overviewFixture(overrides: { kpi1Den?: number; kpi3Den?: number; kpi5Eval?: number }): FieldbeatOverviewResponse {
  return {
    meta: { generatedAt: "", contractVersion: "", effectiveDateFrom: null, effectiveDateTo: null, filtersApplied: {} },
    kpi1: { numerator: 0, denominator: overrides.kpi1Den ?? 0, percentage: null, missingTechnician: 0, missingClient: 0, missingEquipment: 0, multipleMissing: 0, drillDownFilter: { qualityStatus: null, note: "" } },
    kpi2: { reportsWithAccessibleTicket: 0, reportsWithMissingOrRestrictedTicket: 0, reportsWithoutReportedTicket: 0, evaluableReports: 0, percentage: null, distributionByTicketCount: [], drillDownFilter: { ticketStatus: "missing_or_restricted" } },
    kpi3: { numerator: 0, denominator: overrides.kpi3Den ?? 0, percentage: null, structured: 0, textConfident: 0, textAmbiguous: 0, missing: 0, notApplicable: 0, sumMatchesDenominator: true, drillDownFilter: { teamIdentificationStatus: "MISSING" } },
    kpi4: { reportGrain: { universe: 0, fullyTraceable: 0, containsPlaceholder: 0, containsNoMatch: 0, containsAmbiguous: 0, combinedProblems: 0 }, lineGrain: { totalLines: 0, directMatches: 0, historicalAliasMatches: 0, descriptionMatches: 0, ambiguous: 0, placeholders: 0, noMatch: 0 }, historicalAliasLimitation: "" },
    kpi5: { evaluableReports: overrides.kpi5Eval ?? 0, consistentReports: 0, impossibleChronology: 0, zeroDurationWarnings: 0, nullDurationWarnings: 0, percentage: null, apparentCreationLagMedian: null, apparentCreationLagP90: null, apparentCreationLagDisclaimer: "" },
    evolution: [],
    kpi6: { affectedReports: 0, evaluableReports: 0, percentage: null, highSeverityReports: 0, mediumSeverityReports: 0, lowSeverityReports: 0, warningOnlyReports: 0, dominantCode: null, oldestAffectedReportDate: null, totalSecondaryIssues: 0, distributionByCode: [] }
  };
}

test("isOverviewEmpty: true solo cuando KPI1/KPI3/KPI5 tienen universo cero simultáneamente", () => {
  assert.equal(isOverviewEmpty(overviewFixture({})), true);
  assert.equal(isOverviewEmpty(overviewFixture({ kpi1Den: 5 })), false);
  assert.equal(isOverviewEmpty(overviewFixture({ kpi3Den: 5 })), false);
  assert.equal(isOverviewEmpty(overviewFixture({ kpi5Eval: 5 })), false);
});

function qualityFixture(overrides: { kpi1Den?: number; kpi3Den?: number; kpi4Universe?: number }): FieldbeatQualityResponse {
  const o = overviewFixture({});
  return {
    meta: o.meta,
    kpi1: { ...o.kpi1, denominator: overrides.kpi1Den ?? 0 },
    kpi2: o.kpi2,
    kpi3: { ...o.kpi3, denominator: overrides.kpi3Den ?? 0 },
    kpi4: { ...o.kpi4, reportGrain: { ...o.kpi4.reportGrain, universe: overrides.kpi4Universe ?? 0 } },
    kpi5: o.kpi5,
    teamEvolution: [],
    historicalAliasLimitation: ""
  };
}

test("isQualityEmpty: true solo cuando KPI1/KPI3/KPI4 tienen universo cero simultáneamente", () => {
  assert.equal(isQualityEmpty(qualityFixture({})), true);
  assert.equal(isQualityEmpty(qualityFixture({ kpi1Den: 3 })), false);
  assert.equal(isQualityEmpty(qualityFixture({ kpi3Den: 3 })), false);
  assert.equal(isQualityEmpty(qualityFixture({ kpi4Universe: 3 })), false);
});

function crossingFixture(grandTotal: number): FieldbeatCrossingResponse {
  return {
    type: "task_type_missing_field",
    rowDimensionLabel: "",
    colDimensionLabel: "",
    rows: [],
    cols: [],
    cells: [],
    rowTotals: {},
    colTotals: {},
    grandTotal,
    totalRows: 0,
    totalCols: 0,
    shownRows: 0,
    shownCols: 0,
    aggregated: false,
    generatedAt: "",
    filtersApplied: {}
  };
}

test("isCrossingEmpty: true únicamente con grandTotal=0", () => {
  assert.equal(isCrossingEmpty(crossingFixture(0)), true);
  assert.equal(isCrossingEmpty(crossingFixture(1)), false);
});

function reportsFixture(totalRows: number): FieldbeatReportsResponse {
  return {
    rows: [],
    view: "exceptions",
    page: 1,
    pageSize: 25,
    totalRows,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
    effectiveRangeFrom: totalRows === 0 ? 0 : 1,
    effectiveRangeTo: totalRows,
    sort: "date",
    direction: "desc",
    search: null
  };
}

test("isReportsEmpty: true únicamente con totalRows=0", () => {
  assert.equal(isReportsEmpty(reportsFixture(0)), true);
  assert.equal(isReportsEmpty(reportsFixture(1)), false);
});
