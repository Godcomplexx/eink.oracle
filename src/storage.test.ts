import { beforeEach, describe, expect, it } from "vitest";

import { loadState, saveState } from "./storage";

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
});
