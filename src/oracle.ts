import { CARDS } from "./cards";
import type {
  DrawRecord,
  JourneyState,
  OracleCard,
  OracleState,
  Rarity,
  UnlockCondition,
} from "./types";

const GRAPH: Record<JourneyState, Partial<Record<JourneyState, number>>> = {
  OPENING: { OPENING: 0.25, DISCOVERY: 0.45, REFLECTION: 0.3 },
  DISCOVERY: { REFLECTION: 0.3, ACTION: 0.35, CHANGE: 0.2, DISCOVERY: 0.15 },
  REFLECTION: { DISCOVERY: 0.2, ACTION: 0.25, RELEASE: 0.35, REFLECTION: 0.2 },
  ACTION: { CHANGE: 0.45, DISCOVERY: 0.2, RELEASE: 0.2, ACTION: 0.15 },
  CHANGE: { RELEASE: 0.35, RENEWAL: 0.35, REFLECTION: 0.2, CHANGE: 0.1 },
  RELEASE: { RENEWAL: 0.5, OPENING: 0.25, REFLECTION: 0.25 },
  RENEWAL: { OPENING: 0.4, DISCOVERY: 0.35, ACTION: 0.25 },
};

const RARITY_WEIGHTS: Record<Rarity, number> = {
  COMMON: 1,
  RARE: 0.09,
  ARCANE: 0.025,
  ANOMALY: 0.008,
  HOUDINI: 0.002,
};

const RARE_RARITIES = new Set<Rarity>(["RARE", "ARCANE", "ANOMALY", "HOUDINI"]);

export interface DrawResult {
  card: OracleCard;
  record: DrawRecord;
  state: OracleState;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumber(dateKey: string): number {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isYesterday(previous: string | null, current: string): boolean {
  return previous !== null && dayNumber(current) - dayNumber(previous) === 1;
}

function weightedPick<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, weight(item)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  if (total <= 0) {
    const fallback = items[Math.floor(random() * items.length)];
    if (!fallback) throw new Error("Cannot select from an empty pool.");
    return fallback;
  }

  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }

  const last = weighted.at(-1)?.item;
  if (!last) throw new Error("Cannot select from an empty pool.");
  return last;
}

function nextGraphNode(state: OracleState, random: () => number): JourneyState {
  const transitions = GRAPH[state.currentNode];
  const nodes = Object.keys(transitions) as JourneyState[];
  return weightedPick(nodes, (node) => transitions[node] ?? 0, random);
}

function conditionMet(condition: UnlockCondition, state: OracleState): boolean {
  switch (condition.type) {
    case "journey-days":
      return state.history.length >= condition.minimum;
    case "seen-card":
      return Boolean(state.cardsSeen[condition.cardId]);
    case "unlocked-node":
      return state.unlockedNodes.includes(condition.node);
  }
}

function isUnlocked(card: OracleCard, state: OracleState): boolean {
  return card.unlockConditions.every((condition) => conditionMet(condition, state));
}

function isCoolingDown(card: OracleCard, state: OracleState): boolean {
  let lastIndex = -1;
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index]?.cardId === card.id) {
      lastIndex = index;
      break;
    }
  }
  if (lastIndex < 0) return false;
  return state.history.length - lastIndex <= card.cooldown;
}

function pityMultiplier(state: OracleState): number {
  if (state.daysWithoutRare >= 20) return 3.35;
  if (state.daysWithoutRare >= 15) return 2;
  if (state.daysWithoutRare >= 10) return 1.35;
  return 1;
}

function themeMultiplier(card: OracleCard, state: OracleState): number {
  const recent = state.history.slice(-3);
  const lastTheme = recent.at(-1)?.theme;
  const uses = recent.filter((record) => record.theme === card.theme).length;
  if (lastTheme === card.theme) return 0.12;
  if (uses > 0) return 0.45;
  return 1;
}

function cardWeight(card: OracleCard, state: OracleState): number {
  const pity = RARE_RARITIES.has(card.rarity) ? pityMultiplier(state) : 1;
  return RARITY_WEIGHTS[card.rarity] * pity * themeMultiplier(card, state);
}

function availableCards(state: OracleState, targetNode: JourneyState): OracleCard[] {
  const unlocked = CARDS.filter((card) => isUnlocked(card, state));
  const cooled = unlocked.filter((card) => !isCoolingDown(card, state));
  const safePool = cooled.length > 0 ? cooled : unlocked;
  const matchingNode = safePool.filter((card) => card.state === targetNode);
  return matchingNode.length > 0 ? matchingNode : safePool;
}

function applyGraphEffect(card: OracleCard, state: OracleState): JourneyState {
  if (card.graphEffect.type === "unlock-node") {
    if (!state.unlockedNodes.includes(card.graphEffect.node)) {
      state.unlockedNodes.push(card.graphEffect.node);
    }
  }

  if (card.graphEffect.type === "return-to-previous") {
    return state.history.at(-1)?.state ?? card.state;
  }

  return card.state;
}

function updateSeenCard(card: OracleCard, date: string, state: OracleState): void {
  const seen = state.cardsSeen[card.id];
  state.cardsSeen[card.id] = seen
    ? { ...seen, lastSeen: date, timesSeen: seen.timesSeen + 1 }
    : { firstSeen: date, lastSeen: date, timesSeen: 1 };

  if (card.rarity === "ANOMALY" && !state.foundAnomalies.includes(card.id)) {
    state.foundAnomalies.push(card.id);
  }
}

export function drawDailyCard(
  sourceState: OracleState,
  date = localDateKey(),
  random: () => number = Math.random,
): DrawResult {
  if (sourceState.lastDate === date) {
    throw new Error("A card has already been drawn for this date.");
  }

  const state = structuredClone(sourceState);
  const targetNode = nextGraphNode(state, random);
  const pool = availableCards(state, targetNode);
  const card = weightedPick(pool, (candidate) => cardWeight(candidate, state), random);
  const record: DrawRecord = {
    date,
    cardId: card.id,
    state: card.state,
    theme: card.theme,
    rarity: card.rarity,
  };

  state.currentNode = applyGraphEffect(card, state);
  state.history.push(record);
  state.streak = isYesterday(state.lastDate, date) ? state.streak + 1 : 1;
  state.lastDate = date;
  state.daysWithoutRare = RARE_RARITIES.has(card.rarity) ? 0 : state.daysWithoutRare + 1;
  updateSeenCard(card, date, state);

  return { card, record, state };
}
