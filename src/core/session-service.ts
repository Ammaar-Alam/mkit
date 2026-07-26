import type { SanitizedQuestionContext } from "../adapter/contracts";
import type { StorageRepository } from "../storage";
import type {
  AnswerChoice,
  AttemptRecord,
  AttemptTag,
  Confidence,
  FreshAttemptMode,
  SessionRecord,
} from "../storage/schema";

export interface SessionServiceOptions {
  now?: () => number;
  createId?: () => string;
}

export type AttemptPatch = Partial<
  Pick<
    AttemptRecord,
    | "selection"
    | "eliminations"
    | "confidence"
    | "flagged"
    | "reviewAgain"
    | "note"
    | "tags"
    | "outcome"
    | "categoryCode"
    | "durationMs"
  >
>;

export class SessionService {
  readonly #repository: StorageRepository;
  readonly #now: () => number;
  readonly #createId: () => string;

  constructor(repository: StorageRepository, options: SessionServiceOptions = {}) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async start(
    examKey: string,
    mode: FreshAttemptMode,
    currentQuestionKey: string | null,
  ): Promise<SessionRecord> {
    const now = this.#now();
    return this.#repository.saveSession({
      id: this.#createId(),
      examKey,
      mode,
      status: "active",
      startedAt: now,
      updatedAt: now,
      currentQuestionKey,
      completedAt: null,
      finishedSections: [],
    });
  }

  async setCurrentQuestion(sessionId: string, questionKey: string): Promise<SessionRecord> {
    return this.#updateSession(sessionId, {
      currentQuestionKey: questionKey,
    });
  }

  async archive(sessionId: string): Promise<SessionRecord> {
    return this.#updateSession(sessionId, {
      status: "archived",
    });
  }

  async finishSection(sessionId: string, sectionKey: string): Promise<SessionRecord> {
    const current = await this.#requireSession(sessionId);
    const finishedSections = [...new Set([...current.finishedSections, sectionKey])].sort(
      (left, right) => left.localeCompare(right),
    );
    return this.#updateSession(sessionId, { finishedSections });
  }

  async finish(sessionId: string): Promise<SessionRecord> {
    const completedAt = this.#now();
    return this.#updateSession(sessionId, {
      status: "finished",
      completedAt,
    });
  }

  async getOrCreateAttempt(
    sessionId: string,
    context: SanitizedQuestionContext,
  ): Promise<AttemptRecord> {
    const existing = await this.#repository.getAttempt(sessionId, context.questionKey);
    if (existing) {
      return existing;
    }
    const record: AttemptRecord = {
      sessionId,
      questionKey: context.questionKey,
      selection: null,
      eliminations: [],
      confidence: null,
      flagged: false,
      reviewAgain: false,
      tags: [],
      outcome: "unknown",
      categoryCode: context.categoryCode,
      sectionKey: context.sectionKey,
      passageOrDiscrete: context.passageOrDiscrete,
      durationMs: 0,
      updatedAt: this.#now(),
    };
    return this.#repository.saveAttempt(record);
  }

  async updateAttempt(
    sessionId: string,
    questionKey: string,
    patch: AttemptPatch,
  ): Promise<AttemptRecord> {
    const current = await this.#repository.getAttempt(sessionId, questionKey);
    if (!current) {
      throw new Error("Cannot update an unknown Fresh Attempt question.");
    }
    const updatedAt = nextTimestamp(current.updatedAt, this.#now());
    const next: AttemptRecord = {
      ...current,
      selection: patch.selection !== undefined ? patch.selection : current.selection,
      eliminations: patch.eliminations
        ? normalizeChoices(patch.eliminations)
        : [...current.eliminations],
      confidence: patch.confidence ?? current.confidence,
      flagged: patch.flagged ?? current.flagged,
      reviewAgain: patch.reviewAgain ?? current.reviewAgain,
      tags: patch.tags ? normalizeTags(patch.tags) : [...current.tags],
      outcome: patch.outcome ?? current.outcome,
      categoryCode: patch.categoryCode ?? current.categoryCode,
      durationMs: patch.durationMs ?? current.durationMs,
      updatedAt,
    };
    if (patch.note !== undefined) {
      next.note = patch.note;
      next.noteUpdatedAt = updatedAt;
    }
    return this.#repository.saveAttempt(next);
  }

  async select(
    sessionId: string,
    questionKey: string,
    selection: AnswerChoice,
  ): Promise<AttemptRecord> {
    return this.updateAttempt(sessionId, questionKey, {
      selection,
      outcome: "unknown",
    });
  }

  async toggleElimination(
    sessionId: string,
    questionKey: string,
    choice: AnswerChoice,
  ): Promise<AttemptRecord> {
    const current = await this.#requireAttempt(sessionId, questionKey);
    const restoring = current.eliminations.includes(choice);
    const eliminations = restoring
      ? current.eliminations.filter((item) => item !== choice)
      : [...current.eliminations, choice];
    return this.updateAttempt(sessionId, questionKey, {
      eliminations,
      ...(!restoring && current.selection === choice
        ? { selection: null, outcome: "unknown" as const }
        : {}),
    });
  }

  async setConfidence(
    sessionId: string,
    questionKey: string,
    confidence: Confidence | null,
  ): Promise<AttemptRecord> {
    const current = await this.#requireAttempt(sessionId, questionKey);
    const next: AttemptRecord = {
      ...current,
      confidence,
      updatedAt: nextTimestamp(current.updatedAt, this.#now()),
    };
    return this.#repository.saveAttempt(next);
  }

  async retry(sessionId: string, questionKey: string): Promise<AttemptRecord> {
    const current = await this.#requireAttempt(sessionId, questionKey);
    return this.#repository.saveAttempt({
      ...current,
      selection: null,
      eliminations: [],
      outcome: "unknown",
      updatedAt: nextTimestamp(current.updatedAt, this.#now()),
    });
  }

  async accumulateDuration(
    sessionId: string,
    questionKey: string,
    durationMs: number,
  ): Promise<AttemptRecord> {
    return this.#repository.accumulateDuration(sessionId, questionKey, durationMs);
  }

  async #updateSession(
    sessionId: string,
    patch: Partial<
      Pick<SessionRecord, "status" | "currentQuestionKey" | "completedAt" | "finishedSections">
    >,
  ): Promise<SessionRecord> {
    const current = await this.#requireSession(sessionId);
    return this.#repository.saveSession({
      ...current,
      ...patch,
      finishedSections: patch.finishedSections
        ? [...patch.finishedSections]
        : [...current.finishedSections],
      updatedAt: nextTimestamp(current.updatedAt, this.#now()),
    });
  }

  async #requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await this.#repository.getSession(sessionId);
    if (!session) {
      throw new Error("Fresh Attempt session was not found.");
    }
    return session;
  }

  async #requireAttempt(sessionId: string, questionKey: string): Promise<AttemptRecord> {
    const attempt = await this.#repository.getAttempt(sessionId, questionKey);
    if (!attempt) {
      throw new Error("Fresh Attempt question was not found.");
    }
    return attempt;
  }
}

function normalizeChoices(choices: readonly AnswerChoice[]): AnswerChoice[] {
  return [...new Set(choices)].sort((left, right) => left.localeCompare(right));
}

function normalizeTags(tags: readonly AttemptTag[]): AttemptTag[] {
  return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
}

function nextTimestamp(current: number, candidate: number): number {
  return candidate > current ? candidate : current + 1;
}
