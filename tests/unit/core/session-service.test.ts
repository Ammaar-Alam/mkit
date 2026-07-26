import { describe, expect, it } from "vitest";
import { SessionService } from "../../../src/core/session-service";
import { StorageRepository } from "../../../src/storage";
import { FakeStorageArea } from "../storage/fake-storage";

describe("SessionService eliminations", () => {
  it("makes an eliminated selection unavailable and restores the choice without reselecting it", async () => {
    let now = 100;
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: () => {
        now += 1;
        return now;
      },
    });
    const service = new SessionService(repository, {
      createId: () => "synthetic-session",
      now: () => {
        now += 1;
        return now;
      },
    });
    const session = await service.start("synthetic-exam", "practice", "synthetic-question");
    await service.getOrCreateAttempt(session.id, {
      examKey: "synthetic-exam",
      questionKey: "synthetic-question",
      sectionKey: "cp",
      categoryCode: null,
      passageOrDiscrete: "passage",
    });
    await service.select(session.id, "synthetic-question", "A");
    await service.updateAttempt(session.id, "synthetic-question", { outcome: "correct" });

    const eliminated = await service.toggleElimination(session.id, "synthetic-question", "A");
    expect(eliminated).toMatchObject({
      selection: null,
      eliminations: ["A"],
      outcome: "unknown",
    });

    const restored = await service.toggleElimination(session.id, "synthetic-question", "A");
    expect(restored).toMatchObject({
      selection: null,
      eliminations: [],
      outcome: "unknown",
    });
  });

  it("persists an explicit null selection without treating it as a missing patch", async () => {
    let now = 200;
    const repository = new StorageRepository({
      local: new FakeStorageArea("local"),
      now: () => {
        now += 1;
        return now;
      },
    });
    const service = new SessionService(repository, {
      createId: () => "synthetic-toggle-session",
      now: () => {
        now += 1;
        return now;
      },
    });
    const session = await service.start(
      "synthetic-toggle-exam",
      "practice",
      "synthetic-toggle-question",
    );
    await service.getOrCreateAttempt(session.id, {
      examKey: "synthetic-toggle-exam",
      questionKey: "synthetic-toggle-question",
      sectionKey: "cp",
      categoryCode: null,
      passageOrDiscrete: "discrete",
    });
    await service.select(session.id, "synthetic-toggle-question", "C");

    const cleared = await service.updateAttempt(session.id, "synthetic-toggle-question", {
      selection: null,
      outcome: "unknown",
    });

    expect(cleared.selection).toBeNull();
    expect((await repository.getAttempt(session.id, "synthetic-toggle-question"))?.selection).toBe(
      null,
    );
  });
});
