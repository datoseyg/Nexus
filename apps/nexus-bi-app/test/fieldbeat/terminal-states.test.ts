import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTerminalFieldbeatTaskState,
  isKnownFieldbeatTaskState,
  KNOWN_FIELDBEAT_TASK_STATES,
  TERMINAL_FIELDBEAT_TASK_STATES
} from "../../lib/fieldbeat-terminal-states.ts";

test("FINISHED y ARCHIVED son terminales", () => {
  assert.equal(isTerminalFieldbeatTaskState("FINISHED"), true);
  assert.equal(isTerminalFieldbeatTaskState("ARCHIVED"), true);
});

test("los otros 7 estados reales no son terminales", () => {
  const nonTerminal = KNOWN_FIELDBEAT_TASK_STATES.filter(s => !TERMINAL_FIELDBEAT_TASK_STATES.includes(s as never));
  assert.deepEqual(
    nonTerminal.sort(),
    ["ASSIGNED", "CONTINUED", "ON_ROUTE", "PAUSED", "SCHEDULED", "SENT", "STARTED"].sort()
  );
  for (const state of nonTerminal) {
    assert.equal(isTerminalFieldbeatTaskState(state), false, `${state} no debería ser terminal`);
  }
});

test("un estado desconocido nunca es terminal por defecto", () => {
  assert.equal(isTerminalFieldbeatTaskState("SOME_FUTURE_STATE"), false);
  assert.equal(isKnownFieldbeatTaskState("SOME_FUTURE_STATE"), false);
});

test("isKnownFieldbeatTaskState reconoce los 9 estados reales", () => {
  for (const state of KNOWN_FIELDBEAT_TASK_STATES) {
    assert.equal(isKnownFieldbeatTaskState(state), true);
  }
});
