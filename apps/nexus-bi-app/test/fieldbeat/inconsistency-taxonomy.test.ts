import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReportInconsistencies,
  primaryInconsistency,
  INCONSISTENCY_TAXONOMY,
  type ReportInconsistencyInput
} from "../../lib/fieldbeat-inconsistency-taxonomy.ts";

function cleanReport(overrides: Partial<ReportInconsistencyInput> = {}): ReportInconsistencyInput {
  return {
    isClosed: true,
    isFinished: true,
    chronologyImpossible: false,
    finishedZeroDuration: false,
    finishedNullDuration: false,
    teamIdentification: "STRUCTURED_IDENTIFIED",
    hasTicketReported: false,
    ticketAccessible: null,
    minimumFieldsComplete: true,
    partMatchStatuses: [],
    ...overrides
  };
}

test("reporte limpio no genera ningún finding", () => {
  assert.deepEqual(classifyReportInconsistencies(cleanReport()), []);
});

test("cronología imposible dispara TEMPORAL_IMPOSSIBLE_CHRONOLOGY (Alta)", () => {
  const findings = classifyReportInconsistencies(cleanReport({ chronologyImpossible: true }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "TEMPORAL_IMPOSSIBLE_CHRONOLOGY");
  assert.equal(findings[0].severity, "Alta");
});

test("repuesto AMBIGUOUS_MATCH dispara PART_AMBIGUOUS_MATCH (Alta)", () => {
  const findings = classifyReportInconsistencies(cleanReport({ partMatchStatuses: ["AMBIGUOUS_MATCH"] }));
  assert.deepEqual(findings.map(f => f.code), ["PART_AMBIGUOUS_MATCH"]);
});

test("ticket informado pero inaccesible dispara TICKET_REPORTED_INACCESSIBLE, ticket no informado no dispara nada", () => {
  const inaccessible = classifyReportInconsistencies(cleanReport({ hasTicketReported: true, ticketAccessible: false }));
  assert.deepEqual(inaccessible.map(f => f.code), ["TICKET_REPORTED_INACCESSIBLE"]);

  const noTicket = classifyReportInconsistencies(cleanReport({ hasTicketReported: false, ticketAccessible: null }));
  assert.deepEqual(noTicket, []);
});

test("equipo MISSING en reporte cerrado dispara TEAM_MISSING, pero no en reporte abierto", () => {
  const closedMissing = classifyReportInconsistencies(cleanReport({ teamIdentification: "MISSING" }));
  assert.deepEqual(closedMissing.map(f => f.code), ["TEAM_MISSING"]);

  const openMissing = classifyReportInconsistencies(cleanReport({ isClosed: false, teamIdentification: "MISSING" }));
  assert.deepEqual(openMissing, []);
});

test("PLACEHOLDER_VALUE aislado dispara PART_PLACEHOLDER_ONLY (Baja), pero no si coexiste con NO_MATCH", () => {
  const onlyPlaceholder = classifyReportInconsistencies(cleanReport({ partMatchStatuses: ["PLACEHOLDER_VALUE"] }));
  assert.deepEqual(onlyPlaceholder.map(f => f.code), ["PART_PLACEHOLDER_ONLY"]);

  const withNoMatch = classifyReportInconsistencies(cleanReport({ partMatchStatuses: ["PLACEHOLDER_VALUE", "NO_MATCH"] }));
  assert.deepEqual(withNoMatch.map(f => f.code).sort(), ["PART_NO_MATCH"]);
});

test("duración cero y duración null en FINISHED son findings distintos (Advertencia)", () => {
  const zero = classifyReportInconsistencies(cleanReport({ finishedZeroDuration: true }));
  assert.deepEqual(zero.map(f => f.code), ["FINISHED_ZERO_DURATION"]);

  const nullDuration = classifyReportInconsistencies(cleanReport({ finishedNullDuration: true }));
  assert.deepEqual(nullDuration.map(f => f.code), ["FINISHED_NULL_DURATION"]);
});

test("un reporte puede acumular varios findings simultáneos", () => {
  const findings = classifyReportInconsistencies(
    cleanReport({ chronologyImpossible: true, finishedZeroDuration: true, minimumFieldsComplete: false })
  );
  assert.deepEqual(
    findings.map(f => f.code).sort(),
    ["FINISHED_ZERO_DURATION", "MIN_FIELDS_INCOMPLETE", "TEMPORAL_IMPOSSIBLE_CHRONOLOGY"].sort()
  );
});

test("primaryInconsistency elige la mayor severidad, no la primera generada", () => {
  const findings = classifyReportInconsistencies(cleanReport({ finishedZeroDuration: true, chronologyImpossible: true }));
  const primary = primaryInconsistency(findings);
  assert.equal(primary?.code, "TEMPORAL_IMPOSSIBLE_CHRONOLOGY");
});

test("primaryInconsistency: empate de severidad se resuelve por orden de declaración en la taxonomía", () => {
  const findings = classifyReportInconsistencies(
    cleanReport({ teamIdentification: "TEXT_AMBIGUOUS", partMatchStatuses: ["AMBIGUOUS_MATCH"] })
  );
  // Ambos Alta: PART_AMBIGUOUS_MATCH está declarado antes que TEAM_TEXT_AMBIGUOUS en INCONSISTENCY_TAXONOMY.
  assert.equal(primaryInconsistency(findings)?.code, "PART_AMBIGUOUS_MATCH");
});

test("primaryInconsistency de una lista vacía es null", () => {
  assert.equal(primaryInconsistency([]), null);
});

test("todo código generado por el clasificador existe en INCONSISTENCY_TAXONOMY", () => {
  const knownCodes = new Set(INCONSISTENCY_TAXONOMY.map(d => d.code));
  const findings = classifyReportInconsistencies(
    cleanReport({
      chronologyImpossible: true,
      finishedZeroDuration: true,
      finishedNullDuration: true,
      teamIdentification: "TEXT_AMBIGUOUS",
      hasTicketReported: true,
      ticketAccessible: false,
      minimumFieldsComplete: false,
      partMatchStatuses: ["AMBIGUOUS_MATCH", "NO_MATCH"]
    })
  );
  for (const finding of findings) assert.ok(knownCodes.has(finding.code));
});
