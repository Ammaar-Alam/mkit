import type { AnswerChoice } from "../storage/schema";

export type ProtectionState =
  | "BOOT_VEILED"
  | "NON_REVIEW"
  | "MASKED"
  | "UNSUPPORTED"
  | "NORMAL_REVIEW";

export type SessionState = "NONE" | "PRACTICE_ACTIVE" | "TEST_ACTIVE" | "TEST_FINISHED";

export type QuestionRevealState = "CONCEALED" | "FEEDBACK" | "ORIGINAL";

export interface ReviewState {
  protection: ProtectionState;
  session: SessionState;
  reveal: QuestionRevealState;
  selection: AnswerChoice | null;
}

export type ReviewAction =
  | { type: "CLASSIFY_NON_REVIEW" }
  | { type: "MASK_VERIFIED" }
  | { type: "MASK_UNSUPPORTED" }
  | { type: "NORMAL_REVIEW" }
  | { type: "START_PRACTICE" }
  | { type: "START_TEST" }
  | { type: "RESTORE_SELECTION"; selection: AnswerChoice | null }
  | { type: "SELECT"; selection: AnswerChoice }
  | { type: "CHECK" }
  | { type: "REVEAL_ORIGINAL" }
  | { type: "RETRY" }
  | { type: "FINISH_TEST" }
  | { type: "QUESTION_CHANGE"; selection: AnswerChoice | null }
  | { type: "END_SESSION" };

export const INITIAL_REVIEW_STATE: ReviewState = {
  protection: "BOOT_VEILED",
  session: "NONE",
  reveal: "CONCEALED",
  selection: null,
};

export function reduceReviewState(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "CLASSIFY_NON_REVIEW":
      return {
        ...INITIAL_REVIEW_STATE,
        protection: "NON_REVIEW",
      };
    case "MASK_VERIFIED":
      return {
        ...state,
        protection: "MASKED",
      };
    case "MASK_UNSUPPORTED":
      return {
        ...state,
        protection: "UNSUPPORTED",
        reveal: "CONCEALED",
      };
    case "NORMAL_REVIEW":
      return {
        ...INITIAL_REVIEW_STATE,
        protection: "NORMAL_REVIEW",
      };
    case "START_PRACTICE":
      requireMasked(state, action.type);
      return {
        ...state,
        session: "PRACTICE_ACTIVE",
        reveal: "CONCEALED",
        selection: null,
      };
    case "START_TEST":
      requireMasked(state, action.type);
      return {
        ...state,
        session: "TEST_ACTIVE",
        reveal: "CONCEALED",
        selection: null,
      };
    case "RESTORE_SELECTION":
      requireActiveSession(state, action.type);
      return {
        ...state,
        selection: action.selection,
      };
    case "SELECT":
      requireActiveSession(state, action.type);
      if (state.reveal !== "CONCEALED") {
        throw new Error("A revealed Practice result must be retried before changing the answer.");
      }
      return {
        ...state,
        selection: action.selection,
      };
    case "CHECK":
      if (state.session !== "PRACTICE_ACTIVE" || !state.selection) {
        throw new Error("Practice Check requires an active session and a fresh selection.");
      }
      return {
        ...state,
        reveal: "FEEDBACK",
      };
    case "REVEAL_ORIGINAL":
      if (
        state.reveal !== "FEEDBACK" ||
        (state.session !== "PRACTICE_ACTIVE" && state.session !== "TEST_FINISHED")
      ) {
        throw new Error("The original attempt is available only after fresh feedback is revealed.");
      }
      return {
        ...state,
        reveal: "ORIGINAL",
      };
    case "RETRY":
      if (state.session !== "PRACTICE_ACTIVE" || state.reveal === "CONCEALED") {
        throw new Error("Retry is available only after checking a Practice answer.");
      }
      return {
        ...state,
        reveal: "CONCEALED",
        selection: null,
      };
    case "FINISH_TEST":
      if (state.session !== "TEST_ACTIVE") {
        throw new Error("Only an active Test session can be finished.");
      }
      return {
        ...state,
        session: "TEST_FINISHED",
        reveal: "CONCEALED",
      };
    case "QUESTION_CHANGE":
      requireActiveSession(state, action.type);
      return {
        ...state,
        protection: "BOOT_VEILED",
        reveal: "CONCEALED",
        selection: action.selection,
      };
    case "END_SESSION":
      return {
        ...state,
        session: "NONE",
        reveal: "CONCEALED",
        selection: null,
      };
  }
}

function requireMasked(state: ReviewState, action: ReviewAction["type"]): void {
  if (state.protection !== "MASKED") {
    throw new Error(`${action} requires a verified masked review.`);
  }
}

function requireActiveSession(state: ReviewState, action: ReviewAction["type"]): void {
  if (state.session !== "PRACTICE_ACTIVE" && state.session !== "TEST_ACTIVE") {
    throw new Error(`${action} requires an active Fresh Attempt session.`);
  }
}
