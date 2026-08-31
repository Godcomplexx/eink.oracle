import { ORACLE_CONFIG } from "./config";
import type {
  DrawRecord,
  JourneyEdge,
  JourneyState,
  OracleState,
  Rarity,
  SeenCard,
} from "./types";

const STORAGE_KEY = "your-own-houdini:oracle-state:v3";
const LEGACY_STORAGE_KEYS = ["your-own-houdini:oracle-state:v2"];

interface LegacyDrawRecord {
  date: string;
  cardId: string;
  state: JourneyState;
  theme: string;
  rarity: Rarity;
}

interface LegacyOracleState {
  version: 1;
  anonymousId: string;
  currentNode: JourneyState;
  history: LegacyDrawRecord[];
  lastDate: string | null;
  streak: number;
  daysWithoutRare: number;
  cardsSeen: Record<string, SeenCard>;
  unlockedNodes: string[];
  completedSets: string[];
  foundAnomalies: string[];
}

function createAnonymousId(): string {
  return crypto.randomUUID();
}

export function createInitialState(anonymousId = createAnonymousId()): OracleState {
  return {
    version: 2,
    deckVersion: ORACLE_CONFIG.deckVersion,
    algorithmVersion: ORACLE_CONFIG.algorithmVersion,
    anonymousId,
    currentNode: ORACLE_CONFIG.entryNode,
    history: [],
    lastDate: null,
    streak: 0,
    daysWithoutRare: 0,
    cardsSeen: {},
    unlockedNodes: [],
    completedSets: [],
    foundAnomalies: [],
    conditionBypassDraws: 0,
    graph: { edges: [], events: [] },
  };
}

export function isOracleState(value: unknown): value is OracleState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<OracleState>;
  return (
    candidate.version === 2 &&
    typeof candidate.deckVersion === "number" &&
    typeof candidate.algorithmVersion === "number" &&
    typeof candidate.anonymousId === "string" &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.unlockedNodes) &&
    typeof candidate.cardsSeen === "object" &&
    candidate.cardsSeen !== null &&
    typeof candidate.graph === "object" &&
    candidate.graph !== null &&
    Array.isArray(candidate.graph.edges) &&
    Array.isArray(candidate.graph.events)
  );
}

export function normalizeOracleState(state: OracleState): OracleState {
  return {
    ...state,
    conditionBypassDraws: Number.isInteger(state.conditionBypassDraws)
      ? state.conditionBypassDraws
      : 0,
  };
}

function isLegacyState(value: unknown): value is LegacyOracleState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<LegacyOracleState>;
  return (
    candidate.version === 1 &&
    typeof candidate.anonymousId === "string" &&
    typeof candidate.currentNode === "string" &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.unlockedNodes) &&
    Array.isArray(candidate.completedSets) &&
    Array.isArray(candidate.foundAnomalies) &&
    typeof candidate.cardsSeen === "object" &&
    candidate.cardsSeen !== null
  );
}

function migratedDrawId(record: LegacyDrawRecord, sequence: number): string {
  return `draw:${record.date}:${String(sequence).padStart(4, "0")}:${record.cardId}`;
}

function migrateLegacyState(legacy: LegacyOracleState): OracleState {
  let previousDrawId: string | null = null;
  let previousState = ORACLE_CONFIG.entryNode;
  const edges: JourneyEdge[] = [];

  const history: DrawRecord[] = legacy.history.map((record, index) => {
    const sequence = index + 1;
    const id = migratedDrawId(record, sequence);
    const migrated: DrawRecord = {
      ...record,
      id,
      sequence,
      previousDrawId,
      previousState,
      targetState: record.state,
      resultingState: record.state,
      deckVersion: 0,
      algorithmVersion: 1,
    };

    edges.push({
      id: `edge:${id}`,
      fromDrawId: previousDrawId,
      toDrawId: id,
      fromState: previousState,
      toState: record.state,
      type: "PROGRESSION",
    });
    previousDrawId = id;
    previousState = record.state;
    return migrated;
  });

  const lastRecord = history.at(-1);
  const lastEdge = edges.at(-1);
  if (lastRecord && lastEdge) {
    lastRecord.resultingState = legacy.currentNode;
    lastEdge.toState = legacy.currentNode;
  }

  return {
    version: 2,
    deckVersion: ORACLE_CONFIG.deckVersion,
    algorithmVersion: ORACLE_CONFIG.algorithmVersion,
    anonymousId: legacy.anonymousId,
    currentNode: legacy.currentNode,
    history,
    lastDate: legacy.lastDate,
    streak: legacy.streak,
    daysWithoutRare: legacy.daysWithoutRare,
    cardsSeen: legacy.cardsSeen,
    unlockedNodes: legacy.unlockedNodes,
    completedSets: legacy.completedSets,
    foundAnomalies: legacy.foundAnomalies,
    conditionBypassDraws: 0,
    graph: { edges, events: [] },
  };
}

function readStoredState(key: string): unknown {
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : null;
}

export function loadState(): OracleState {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const parsed = readStoredState(key);
      if (isOracleState(parsed)) {
        return normalizeOracleState(parsed);
      }
      if (isLegacyState(parsed)) {
        const migrated = migrateLegacyState(parsed);
        saveState(migrated);
        return migrated;
      }
    } catch {
      // Try a previous storage version before creating a new journey.
    }
  }

  return createInitialState();
}

export function saveState(state: OracleState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
