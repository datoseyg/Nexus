import { test } from "node:test";
import assert from "node:assert/strict";
import { viewKpi1, viewKpi2, viewKpi3, viewKpi4, viewKpi5, viewKpi6 } from "../../lib/fieldbeat-quality-kpi-view.ts";
import type {
  Kpi1StructuralCompleteness,
  Kpi2TicketLinkage,
  Kpi3TeamIdentification,
  Kpi4PartsTraceability,
  Kpi5TemporalConsistency,
  Kpi6InformationInconsistencies
} from "../../types/fieldbeat-quality.ts";

test("viewKpi1: denominador cero produce isZeroDenominator=true, tone attention, nunca 'Información todavía no disponible'", () => {
  const kpi: Kpi1StructuralCompleteness = {
    numerator: 0,
    denominator: 0,
    percentage: null,
    missingTechnician: 0,
    missingClient: 0,
    missingEquipment: 0,
    multipleMissing: 0,
    drillDownFilter: { qualityStatus: null, note: "" }
  };
  const view = viewKpi1(kpi);
  assert.equal(view.isZeroDenominator, true);
  assert.equal(view.tone, "attention");
  assert.equal(view.valueLabel, "Sin datos");
  assert.ok(!view.interpretation.includes("Información todavía no disponible"));
});

test("viewKpi1: caso normal formatea porcentaje y desglose", () => {
  const kpi: Kpi1StructuralCompleteness = {
    numerator: 2845,
    denominator: 3609,
    percentage: 78.83,
    missingTechnician: 193,
    missingClient: 0,
    missingEquipment: 606,
    multipleMissing: 35,
    drillDownFilter: { qualityStatus: null, note: "" }
  };
  const view = viewKpi1(kpi);
  assert.equal(view.isZeroDenominator, false);
  assert.equal(view.tone, "neutral");
  assert.match(view.valueLabel, /78[.,]8/);
  assert.match(view.contextLabel, /2\.845/);
  assert.match(view.interpretation, /193/);
});

test("viewKpi2: sin tickets informados es denominador cero", () => {
  const kpi: Kpi2TicketLinkage = {
    reportsWithAccessibleTicket: 0,
    reportsWithMissingOrRestrictedTicket: 0,
    reportsWithoutReportedTicket: 50,
    evaluableReports: 0,
    percentage: null,
    distributionByTicketCount: [],
    drillDownFilter: { ticketStatus: "missing_or_restricted" }
  };
  const view = viewKpi2(kpi);
  assert.equal(view.isZeroDenominator, true);
  assert.match(view.interpretation, /No hay reportes con ticket informado/);
});

test("viewKpi3: desglose exhaustivo aparece en la interpretación", () => {
  const kpi: Kpi3TeamIdentification = {
    numerator: 3115,
    denominator: 3609,
    percentage: 86.31,
    structured: 3099,
    textConfident: 16,
    textAmbiguous: 0,
    missing: 494,
    notApplicable: 0,
    sumMatchesDenominator: true,
    drillDownFilter: { teamIdentificationStatus: "MISSING" }
  };
  const view = viewKpi3(kpi);
  assert.match(view.interpretation, /Estructurado: 3\.099/);
  assert.match(view.interpretation, /Texto confiable: 16/);
});

test("viewKpi4: porcentaje se calcula a nivel de reporte, nunca mezclado con grano línea", () => {
  const kpi: Kpi4PartsTraceability = {
    reportGrain: { universe: 1809, fullyTraceable: 597, containsPlaceholder: 696, containsNoMatch: 467, containsAmbiguous: 56, combinedProblems: 10 },
    lineGrain: { totalLines: 2193, directMatches: 927, historicalAliasMatches: 0, descriptionMatches: 0, ambiguous: 56, placeholders: 721, noMatch: 489 },
    historicalAliasLimitation: "Equivalencias históricas disponibles solo cuando existe alias validado"
  };
  const view = viewKpi4(kpi);
  assert.match(view.valueLabel, /33[.,]0/); // 597/1809 = 33.0%
  assert.match(view.contextLabel, /597 \/ 1\.809/);
  assert.match(view.interpretation, /927/);
});

test("viewKpi5: una transición administrativa anterior a programación es descriptiva, no fuerza tono de error", () => {
  const kpi: Kpi5TemporalConsistency = {
    evaluableReports: 3741,
    consistentReports: 3722,
    impossibleChronology: 19,
    zeroDurationWarnings: 6,
    nullDurationWarnings: 5,
    percentage: 99.49,
    apparentCreationLagMedian: 12,
    apparentCreationLagP90: 45,
    apparentCreationLagDisclaimer: "Proxy exploratorio"
  };
  const view = viewKpi5(kpi);
  assert.equal(view.tone, "neutral");
  assert.match(view.interpretation, /19 con transición administrativa anterior a la programación \(dato descriptivo, no issue\)/);
});

test("viewKpi6: severidad Alta > 0 fuerza tone attention", () => {
  const kpi: Kpi6InformationInconsistencies = {
    affectedReports: 2274,
    evaluableReports: 3747,
    percentage: 60.69,
    highSeverityReports: 75,
    mediumSeverityReports: 1804,
    lowSeverityReports: 390,
    warningOnlyReports: 5,
    dominantCode: "TICKET_REPORTED_INACCESSIBLE",
    oldestAffectedReportDate: "2024-01-01",
    totalSecondaryIssues: 694,
    distributionByCode: []
  };
  const view = viewKpi6(kpi);
  assert.equal(view.tone, "attention");
  assert.match(view.interpretation, /Causa principal: TICKET_REPORTED_INACCESSIBLE/);
});

test("viewKpi6: cero reportes afectados es tone neutral, nunca attention falso positivo", () => {
  const kpi: Kpi6InformationInconsistencies = {
    affectedReports: 0,
    evaluableReports: 100,
    percentage: 0,
    highSeverityReports: 0,
    mediumSeverityReports: 0,
    lowSeverityReports: 0,
    warningOnlyReports: 0,
    dominantCode: null,
    oldestAffectedReportDate: null,
    totalSecondaryIssues: 0,
    distributionByCode: []
  };
  const view = viewKpi6(kpi);
  assert.equal(view.tone, "neutral");
  assert.equal(view.isZeroDenominator, false); // evaluableReports=100, no es un denominador cero
});
