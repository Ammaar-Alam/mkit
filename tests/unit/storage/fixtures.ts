import {
  type AttemptRecord,
  type MKitStore,
  type SessionRecord,
  STORE_SCHEMA_VERSION,
} from "../../../src/storage";
import { createDefaultStore } from "../../../src/storage/codec";

export function makeStore(): MKitStore {
  return createDefaultStore();
}

export function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    examKey: "fl-1",
    mode: "practice",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    currentQuestionKey: "cp-1",
    completedAt: null,
    finishedSections: [],
    ...overrides,
  };
}

export function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    sessionId: "session-1",
    questionKey: "cp-1",
    selection: "A",
    eliminations: ["C"],
    confidence: "unsure",
    flagged: false,
    reviewAgain: false,
    tags: [],
    outcome: "unknown",
    categoryCode: null,
    sectionKey: "cp",
    passageOrDiscrete: "passage",
    durationMs: 1_000,
    updatedAt: 1,
    ...overrides,
  };
}

export function legacySettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    enabled: true,
    defaultMode: "practice",
    encouragementEnabled: true,
    scoreShieldEnabled: true,
    timerDisplayEnabled: false,
    syncEnabled: false,
    updatedAt: 5,
    ...overrides,
  };
}

export function futureStore(): Record<string, unknown> {
  return {
    schemaVersion: STORE_SCHEMA_VERSION + 1,
    futureData: "must-survive",
  };
}
