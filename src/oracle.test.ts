import { describe, expect, it } from "vitest";

import { CARDS } from "./cards";
import { ORACLE_CONFIG } from "./config";
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

  it("allows every live card to be the first observation", () => {
    const rarities = Array.from(new Set(CARDS.map((card) => card.rarity)));
    const totalWeight = rarities.reduce(
      (total, rarity) => total + ORACLE_CONFIG.rarityWeights[rarity],
      0,
    );

    for (const expectedCard of CARDS) {
      const rarityIndex = rarities.indexOf(expectedCard.rarity);
      const precedingWeight = rarities.slice(0, rarityIndex).reduce(
        (total, rarity) => total + ORACLE_CONFIG.rarityWeights[rarity],
        0,
      );
      const rarityRandom = (
        precedingWeight + ORACLE_CONFIG.rarityWeights[expectedCard.rarity] / 2
      ) / totalWeight;
      const rarityPool = CARDS.filter((card) => card.rarity === expectedCard.rarity);
      const cardRandom = (rarityPool.indexOf(expectedCard) + 0.5) / rarityPool.length;
      const values = [rarityRandom, cardRandom, 0.5];
      let randomIndex = 0;

      const result = drawDailyCard(
        createInitialState(`first-${expectedCard.id}`),
        FIRST_DATE,
        () => values[randomIndex++] ?? 0.5,
      );

      expect(result.card.id).toBe(expectedCard.id);
    }
  });

  it("applies the configured rarity percentages to first observations", () => {
    const counts = new Map<string, number>();
    const samples = 10_000;

    for (let index = 0; index < samples; index += 1) {
      const quantile = (index + 0.5) / samples;
      const { card } = drawDailyCard(
        createInitialState(`sample-${index}`),
        FIRST_DATE,
        () => quantile,
      );
      counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
    }

    for (const [rarity, weight] of Object.entries(ORACLE_CONFIG.rarityWeights)) {
      expect((counts.get(rarity) ?? 0) / samples).toBeCloseTo(weight, 4);
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

  it("allows one more observation from a different browser on the same date", () => {
    const first = drawDailyCard(
      createInitialState("shared-archive"),
      FIRST_DATE,
      undefined,
      { originId: "browser-a" },
    );
    const second = drawDailyCard(first.state, FIRST_DATE, undefined, {
      allowSameDate: true,
      originId: "browser-b",
    });

    expect(second.state.history).toHaveLength(2);
    expect(second.record.id).not.toBe(first.record.id);
    expect(second.state.streak).toBe(1);
    expect(second.state.lastDate).toBe(FIRST_DATE);
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
