import { describe, expect, it } from "vitest";

import { CARDS } from "./cards";
import { applyGraphEffect, conditionMet, drawDailyCard } from "./oracle";
import { createInitialState } from "./storage";

const FIRST_DATE = "2026-09-01";

describe("daily oracle", () => {
  it("returns the same first card for the same journey seed", () => {
    const state = createInitialState("same-browser");

    const first = drawDailyCard(state, FIRST_DATE);
    const repeatedCalculation = drawDailyCard(state, FIRST_DATE);

    expect(repeatedCalculation.card.id).toBe(first.card.id);
    expect(repeatedCalculation.record.id).toBe(first.record.id);
  });

  it("uses only data-declared entry cards on day one", () => {
    const entryIds = new Set(CARDS.filter((card) => card.entryEligible).map((card) => card.id));

    for (let index = 0; index < 500; index += 1) {
      const result = drawDailyCard(createInitialState(`visitor-${index}`), FIRST_DATE);
      expect(entryIds.has(result.card.id)).toBe(true);
    }
  });

  it("distributes new journeys across the dynamic entry pool", () => {
    const counts = new Map<string, number>();
    const visitors = 5_000;

    for (let index = 0; index < visitors; index += 1) {
      const { card } = drawDailyCard(createInitialState(`visitor-${index}`), FIRST_DATE);
      counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
    }

    const entryCards = CARDS.filter((card) => card.entryEligible);
    const expectedShare = 1 / entryCards.length;
    expect(counts.size).toBe(entryCards.length);
    for (const card of entryCards) {
      const share = (counts.get(card.id) ?? 0) / visitors;
      expect(share).toBeGreaterThan(expectedShare * 0.75);
      expect(share).toBeLessThan(expectedShare * 1.25);
    }
  });

  it("unlocks count-based progression only after enough sightings", () => {
    const state = createInitialState("count-browser");
    state.cardsSeen["the-mirror"] = {
      firstSeen: FIRST_DATE,
      lastSeen: "2026-09-03",
      timesSeen: 2,
    };

    const condition = { type: "seen-count", cardId: "the-mirror", minimum: 3 } as const;
    expect(conditionMet(condition, state)).toBe(false);

    state.cardsSeen["the-mirror"]!.timesSeen = 3;
    expect(conditionMet(condition, state)).toBe(true);
  });

  it("stores every draw as a graph node connected to the previous draw", () => {
    const initial = createInitialState("graph-browser");
    const dayOne = drawDailyCard(initial, FIRST_DATE);
    const dayTwo = drawDailyCard(dayOne.state, "2026-09-02");

    expect(dayTwo.state.history).toHaveLength(2);
    expect(dayTwo.state.graph.edges).toHaveLength(2);
    expect(dayTwo.record.previousDrawId).toBe(dayOne.record.id);
    expect(dayTwo.state.graph.edges[1]).toMatchObject({
      fromDrawId: dayOne.record.id,
      toDrawId: dayTwo.record.id,
      fromState: dayOne.state.currentNode,
      toState: dayTwo.state.currentNode,
    });
  });

  it("refuses a second daily draw for an already advanced journey", () => {
    const first = drawDailyCard(createInitialState("locked-browser"), FIRST_DATE);

    expect(() => drawDailyCard(first.state, FIRST_DATE)).toThrow(
      "A card has already been drawn for this date.",
    );
  });

  it("recognizes an ordered card sequence without requiring consecutive days", () => {
    const first = drawDailyCard(createInitialState("sequence-browser"), FIRST_DATE);
    const second = drawDailyCard(first.state, "2026-09-02");
    const third = drawDailyCard(second.state, "2026-09-03");
    third.state.history[0]!.cardId = "the-lock";
    third.state.history[1]!.cardId = "the-mirror";
    third.state.history[2]!.cardId = "the-cabinet";

    expect(conditionMet(
      { type: "seen-sequence", cardIds: ["the-lock", "the-cabinet"] },
      third.state,
    )).toBe(true);
    expect(conditionMet(
      { type: "seen-sequence", cardIds: ["the-cabinet", "the-lock"] },
      third.state,
    )).toBe(false);
  });

  it("lets The Remainder reconnect the graph to an older state", () => {
    let state = createInitialState("memory-browser");
    for (let day = 1; day <= 6; day += 1) {
      state = drawDailyCard(state, `2026-09-${String(day).padStart(2, "0")}`).state;
    }
    const remainder = CARDS.find((card) => card.id === "the-remainder")!;
    const rememberedState = state.history[0]!.resultingState;

    const effect = applyGraphEffect(remainder, state, "test:remainder", "2026-09-07", () => 0);

    expect(effect).toEqual({ resultingState: rememberedState, edgeType: "RETURN" });
  });

  it("stores the one-use prerequisite bypass granted by The Missing Column", () => {
    const state = createInitialState("missing-column-browser");
    const missingColumn = CARDS.find((card) => card.id === "the-missing-column")!;

    applyGraphEffect(missingColumn, state, "test:column", FIRST_DATE, () => 0.5);

    expect(state.conditionBypassDraws).toBe(1);
    expect(state.graph.events.at(-1)).toMatchObject({
      type: "CONDITION_BYPASS_GRANTED",
      draws: 1,
    });
  });
});
