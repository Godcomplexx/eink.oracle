import type { OracleState } from "./types";

const STORAGE_KEY = "your-own-houdini:oracle-state:v2";

function createAnonymousId(): string {
  return crypto.randomUUID();
}

export function createInitialState(): OracleState {
  return {
    version: 1,
    anonymousId: createAnonymousId(),
    currentNode: "OPENING",
    history: [],
    lastDate: null,
    streak: 0,
    daysWithoutRare: 0,
    cardsSeen: {},
    unlockedNodes: [],
    completedSets: [],
    foundAnomalies: [],
  };
}

function isState(value: unknown): value is OracleState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<OracleState>;
  return (
    candidate.version === 1 &&
    typeof candidate.anonymousId === "string" &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.unlockedNodes) &&
    typeof candidate.cardsSeen === "object" &&
    candidate.cardsSeen !== null
  );
}

export function loadState(): OracleState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return createInitialState();

    const parsed: unknown = JSON.parse(stored);
    return isState(parsed) ? parsed : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function saveState(state: OracleState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
