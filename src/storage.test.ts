import { beforeEach, describe, expect, it } from "vitest";

import { drawDailyCard } from "./oracle";
import { createInitialState, loadState, mergeOracleStates, saveState } from "./storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const LEGACY_KEY = "your-own-houdini:oracle-state:v2";
const CURRENT_KEY = "your-own-houdini:oracle-state:v3";

describe("journey storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it("migrates the existing local journey into graph records", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      version: 1,
      anonymousId: "legacy-browser",
      currentNode: "REFLECTION",
      history: [
        {
          date: "2026-08-30",
          cardId: "the-seed",
          state: "OPENING",
          theme: "CHANGE",
          rarity: "COMMON",
        },
        {
          date: "2026-08-31",
          cardId: "the-mirror",
          state: "REFLECTION",
          theme: "SELF",
          rarity: "COMMON",
        },
      ],
      lastDate: "2026-08-31",
      streak: 2,
      daysWithoutRare: 2,
      cardsSeen: {
        "the-seed": { firstSeen: "2026-08-30", lastSeen: "2026-08-30", timesSeen: 1 },
        "the-mirror": { firstSeen: "2026-08-31", lastSeen: "2026-08-31", timesSeen: 1 },
      },
      unlockedNodes: [],
      completedSets: [],
      foundAnomalies: [],
    }));

    const migrated = loadState();

    expect(migrated.version).toBe(2);
    expect(migrated.anonymousId).toBe("legacy-browser");
    expect(migrated.history).toHaveLength(2);
    expect(migrated.graph.edges).toHaveLength(2);
    expect(migrated.history[1]?.previousDrawId).toBe(migrated.history[0]?.id);
    expect(migrated.history[1]?.resultingState).toBe("REFLECTION");
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull();
  });

  it("round-trips the current version without changing the archive", () => {
    const migrated = loadState();
    saveState(migrated);

    expect(loadState()).toEqual(migrated);
  });

  it("joins separate browser observations from the same date into one graph", () => {
    const canonical = drawDailyCard(
      createInitialState("archive-seed"),
      "2026-09-07",
      () => 0.1,
      { originId: "browser-a" },
    ).state;
    const incoming = drawDailyCard(
      createInitialState("guest-seed"),
      "2026-09-07",
      () => 0.9,
      { originId: "browser-b" },
    ).state;

    const merged = mergeOracleStates(canonical, incoming);

    expect(merged.addedCount).toBe(1);
    expect(merged.state.anonymousId).toBe("archive-seed");
    expect(merged.state.history).toHaveLength(2);
    expect(merged.state.history.map((record) => record.date)).toEqual([
      "2026-09-07",
      "2026-09-07",
    ]);
    expect(merged.state.history.map((record) => record.sequence)).toEqual([1, 2]);
    expect(merged.state.graph.edges).toHaveLength(2);
    expect(merged.state.streak).toBe(1);
  });

  it("does not duplicate observations already present in the account", () => {
    const canonical = drawDailyCard(createInitialState("same-archive"), "2026-09-07").state;
    const merged = mergeOracleStates(canonical, structuredClone(canonical));

    expect(merged.addedCount).toBe(0);
    expect(merged.state.history).toEqual(canonical.history);
  });
});
