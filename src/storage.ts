import { ORACLE_CONFIG } from "./config";
import type {
  DrawRecord,
  JourneyEdge,
  JourneyEvent,
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

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function mergedStreak(history: DrawRecord[]): number {
  const dates = uniqueValues(history.map((record) => record.date)).sort();
  if (dates.length === 0) return 0;

  let streak = 1;
  for (let index = dates.length - 1; index > 0; index -= 1) {
    const current = Date.parse(`${dates[index]}T00:00:00Z`);
    const previous = Date.parse(`${dates[index - 1]}T00:00:00Z`);
    if (current - previous !== 86_400_000) break;
    streak += 1;
  }
  return streak;
}

function mergedSeenCards(history: DrawRecord[]): Record<string, SeenCard> {
  const cardsSeen: Record<string, SeenCard> = {};
  for (const record of history) {
    const seen = cardsSeen[record.cardId];
    cardsSeen[record.cardId] = seen
      ? {
          firstSeen: seen.firstSeen < record.date ? seen.firstSeen : record.date,
          lastSeen: seen.lastSeen > record.date ? seen.lastSeen : record.date,
          timesSeen: seen.timesSeen + 1,
        }
      : { firstSeen: record.date, lastSeen: record.date, timesSeen: 1 };
  }
  return cardsSeen;
}

function uniqueEventId(event: JourneyEvent, drawId: string, usedIds: Set<string>): string {
  const preferred = event.id.includes(event.drawId)
    ? event.id.replace(event.drawId, drawId)
    : `event:${drawId}:${event.type.toLowerCase()}`;
  if (!usedIds.has(preferred)) return preferred;
  let suffix = 2;
  while (usedIds.has(`${preferred}:${suffix}`)) suffix += 1;
  return `${preferred}:${suffix}`;
}

export interface OracleMergeResult {
  state: OracleState;
  addedCount: number;
}

/**
 * Appends observations that only exist in another browser while preserving every
 * existing cloud record byte-for-byte. Imported edges retain their original
 * branch, so separate browser journeys can meet inside one account graph.
 */
export function mergeOracleStates(canonical: OracleState, incoming: OracleState): OracleMergeResult {
  const state = structuredClone(normalizeOracleState(canonical));
  const knownDrawIds = new Set(state.history.map((record) => record.id));
  const idMap = new Map<string, string>();
  const addedOriginalIds = new Set<string>();

  for (const record of incoming.history) {
    if (knownDrawIds.has(record.id)) {
      idMap.set(record.id, record.id);
      continue;
    }

    let id = record.id;
    let suffix = 2;
    while (knownDrawIds.has(id)) {
      id = `${record.id}:branch-${suffix}`;
      suffix += 1;
    }

    idMap.set(record.id, id);
    knownDrawIds.add(id);
    addedOriginalIds.add(record.id);
    state.history.push({
      ...record,
      id,
      sequence: state.history.length + 1,
      previousDrawId: record.previousDrawId
        ? idMap.get(record.previousDrawId) ?? record.previousDrawId
        : null,
    });
  }

  if (addedOriginalIds.size === 0) return { state, addedCount: 0 };

  const edgeIds = new Set(state.graph.edges.map((edge) => edge.id));
  for (const edge of incoming.graph.edges) {
    if (!addedOriginalIds.has(edge.toDrawId)) continue;
    const toDrawId = idMap.get(edge.toDrawId)!;
    let id = `edge:${toDrawId}`;
    let suffix = 2;
    while (edgeIds.has(id)) {
      id = `edge:${toDrawId}:${suffix}`;
      suffix += 1;
    }
    edgeIds.add(id);
    state.graph.edges.push({
      ...edge,
      id,
      fromDrawId: edge.fromDrawId ? idMap.get(edge.fromDrawId) ?? edge.fromDrawId : null,
      toDrawId,
    });
  }

  const eventIds = new Set(state.graph.events.map((event) => event.id));
  for (const event of incoming.graph.events) {
    if (!addedOriginalIds.has(event.drawId)) continue;
    const drawId = idMap.get(event.drawId)!;
    const id = uniqueEventId(event, drawId, eventIds);
    eventIds.add(id);
    state.graph.events.push({ ...event, id, drawId } as JourneyEvent);
  }

  const localIsNewest = (incoming.lastDate ?? "") >= (canonical.lastDate ?? "");
  state.currentNode = localIsNewest ? incoming.currentNode : canonical.currentNode;
  state.lastDate = state.history.reduce<string | null>(
    (latest, record) => latest === null || record.date > latest ? record.date : latest,
    null,
  );
  state.streak = mergedStreak(state.history);
  state.cardsSeen = mergedSeenCards(state.history);
  state.daysWithoutRare = 0;
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (["RARE", "ARCANE", "ANOMALY", "HOUDINI"].includes(state.history[index]!.rarity)) break;
    state.daysWithoutRare += 1;
  }
  state.unlockedNodes = uniqueValues([...canonical.unlockedNodes, ...incoming.unlockedNodes]);
  state.completedSets = uniqueValues([...canonical.completedSets, ...incoming.completedSets]);
  state.foundAnomalies = uniqueValues([...canonical.foundAnomalies, ...incoming.foundAnomalies]);
  state.conditionBypassDraws = Math.max(
    canonical.conditionBypassDraws ?? 0,
    incoming.conditionBypassDraws ?? 0,
  );
  state.deckVersion = Math.max(canonical.deckVersion, incoming.deckVersion);
  state.algorithmVersion = Math.max(canonical.algorithmVersion, incoming.algorithmVersion);

  return { state, addedCount: addedOriginalIds.size };
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
