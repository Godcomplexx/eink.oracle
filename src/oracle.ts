import { CARDS } from "./cards";
import { ORACLE_CONFIG } from "./config";
import type {
  DrawRecord,
  JourneyEdgeType,
  JourneyState,
  OracleCard,
  OracleState,
  Rarity,
  UnlockCondition,
} from "./types";

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

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomForJourney(state: OracleState, date: string): () => number {
  const history = state.history.map((record) => record.cardId).join(",");
  return seededRandom(`${state.anonymousId}|${date}|${history}|${ORACLE_CONFIG.algorithmVersion}`);
}

function weightedPick<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, weight(item)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  if (items.length === 0) throw new Error("Cannot select from an empty pool.");
  if (total <= 0) return items[Math.floor(random() * items.length)] ?? items[0]!;

  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }

  return weighted.at(-1)!.item;
}

export function conditionMet(condition: UnlockCondition, state: OracleState): boolean {
  switch (condition.type) {
    case "journey-days":
      return state.history.length >= condition.minimum;
    case "seen-card":
      return Boolean(state.cardsSeen[condition.cardId]);
    case "seen-count":
      return (state.cardsSeen[condition.cardId]?.timesSeen ?? 0) >= condition.minimum;
    case "seen-sequence": {
      let cursor = 0;
      for (const record of state.history) {
        if (record.cardId === condition.cardIds[cursor]) cursor += 1;
        if (cursor === condition.cardIds.length) return true;
      }
      return condition.cardIds.length === 0;
    }
    case "unlocked-node":
      return state.unlockedNodes.includes(condition.node);
  }
}

function isUnlocked(card: OracleCard, state: OracleState): boolean {
  const missingConditions = card.unlockConditions.filter((condition) => !conditionMet(condition, state));
  return missingConditions.length === 0
    || (state.conditionBypassDraws > 0 && missingConditions.length === 1);
}

function usesConditionBypass(card: OracleCard, state: OracleState): boolean {
  return state.conditionBypassDraws > 0
    && card.unlockConditions.filter((condition) => !conditionMet(condition, state)).length === 1;
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
  return ORACLE_CONFIG.pity
    .filter((step) => state.daysWithoutRare >= step.afterDays)
    .reduce((multiplier, step) => Math.max(multiplier, step.multiplier), 1);
}

function rarityWeight(rarity: Rarity, state: OracleState): number {
  const pity = RARE_RARITIES.has(rarity) ? pityMultiplier(state) : 1;
  return ORACLE_CONFIG.rarityWeights[rarity] * pity;
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
  return (card.selectionWeight ?? 1) * themeMultiplier(card, state);
}

function availableCards(state: OracleState): OracleCard[] {
  const unlocked = CARDS.filter((card) => isUnlocked(card, state));
  const cooled = unlocked.filter((card) => !isCoolingDown(card, state));
  return cooled.length > 0 ? cooled : unlocked;
}

function distinctRarities(cards: OracleCard[]): Rarity[] {
  return Array.from(new Set(cards.map((card) => card.rarity)));
}

function selectRarity(cards: OracleCard[], state: OracleState, random: () => number): Rarity {
  return weightedPick(distinctRarities(cards), (rarity) => rarityWeight(rarity, state), random);
}

function cardsInNode(cards: OracleCard[], node: JourneyState): OracleCard[] {
  return cards.filter((card) => card.state === node);
}

function configuredTransitionWeight(from: JourneyState, to: JourneyState): number {
  return ORACLE_CONFIG.transitions[from]?.[to] ?? 0.2;
}

function availableNextNodes(state: OracleState, cards: OracleCard[]): JourneyState[] {
  const lastRecord = state.history.at(-1);
  const lastCard = lastRecord ? CARDS.find((card) => card.id === lastRecord.cardId) : undefined;
  const followsCardPath = lastRecord?.resultingState === lastRecord?.state;
  const declaredNodes = followsCardPath && lastCard?.nextNodes.length
    ? lastCard.nextNodes
    : (Object.keys(ORACLE_CONFIG.transitions[state.currentNode] ?? {}) as JourneyState[]);
  const matchingDeclared = Array.from(new Set(declaredNodes)).filter(
    (node) => cardsInNode(cards, node).length > 0,
  );

  if (matchingDeclared.length > 0) return matchingDeclared;

  const configuredNodes = (Object.keys(ORACLE_CONFIG.transitions[state.currentNode] ?? {}) as JourneyState[])
    .filter((node) => cardsInNode(cards, node).length > 0);
  if (configuredNodes.length > 0) return configuredNodes;

  return Array.from(new Set(cards.map((card) => card.state)));
}

function nodeAvailabilityWeight(nodeCards: OracleCard[], state: OracleState): number {
  return distinctRarities(nodeCards)
    .reduce((total, rarity) => total + rarityWeight(rarity, state), 0);
}

function selectCard(
  state: OracleState,
  random: () => number,
): { card: OracleCard; targetState: JourneyState } {
  const available = availableCards(state);
  if (available.length === 0) throw new Error("The live deck has no available cards.");

  if (state.history.length === 0) {
    const declaredEntryCards = available.filter((card) => card.entryEligible === true);
    const entryCards = declaredEntryCards.length > 0 ? declaredEntryCards : available;
    const rarity = selectRarity(entryCards, state, random);
    const rarityPool = entryCards.filter((card) => card.rarity === rarity);
    const card = weightedPick(rarityPool, (candidate) => cardWeight(candidate, state), random);
    return { card, targetState: card.state };
  }

  const nodes = availableNextNodes(state, available);
  const targetState = weightedPick(
    nodes,
    (node) => (
      configuredTransitionWeight(state.currentNode, node)
      * nodeAvailabilityWeight(cardsInNode(available, node), state)
    ),
    random,
  );
  const nodePool = cardsInNode(available, targetState);
  const rarity = selectRarity(nodePool, state, random);
  const rarityPool = nodePool.filter((card) => card.rarity === rarity);
  const card = weightedPick(rarityPool, (candidate) => cardWeight(candidate, state), random);
  return { card, targetState };
}

function drawId(date: string, sequence: number, cardId: string): string {
  return `draw:${date}:${String(sequence).padStart(4, "0")}:${cardId}`;
}

export function applyGraphEffect(
  card: OracleCard,
  state: OracleState,
  id: string,
  date: string,
  random: () => number,
): { resultingState: JourneyState; edgeType: JourneyEdgeType } {
  const unlockNode = (node: string): void => {
    if (!state.unlockedNodes.includes(node)) {
      state.unlockedNodes.push(node);
      state.graph.events.push({
        id: `event:${id}:unlock:${node}`,
        drawId: id,
        date,
        type: "NODE_UNLOCKED",
        node,
      });
    }
  };

  if (card.graphEffect.type === "unlock-node") {
    unlockNode(card.graphEffect.node);
  }

  if (card.graphEffect.type === "branch-or-return") {
    unlockNode(card.graphEffect.node);
    if (random() < card.graphEffect.returnChance) {
      const priorStates = state.history.slice(0, -1);
      const previousBranch = priorStates[Math.floor(random() * priorStates.length)]?.resultingState
        ?? state.history.at(-1)?.previousState
        ?? ORACLE_CONFIG.entryNode;
      return { resultingState: previousBranch, edgeType: "RETURN" };
    }
  }

  if (card.graphEffect.type === "recall-old-state") {
    const memories = state.history.slice(0, Math.max(0, state.history.length - card.graphEffect.minimumAge));
    const remembered = memories[Math.floor(random() * memories.length)];
    if (remembered) return { resultingState: remembered.resultingState, edgeType: "RETURN" };
  }

  if (card.graphEffect.type === "grant-bypass") {
    state.conditionBypassDraws = Math.max(state.conditionBypassDraws, card.graphEffect.draws);
    state.graph.events.push({
      id: `event:${id}:bypass`,
      drawId: id,
      date,
      type: "CONDITION_BYPASS_GRANTED",
      draws: card.graphEffect.draws,
    });
  }

  if (card.graphEffect.type === "return-to-previous") {
    const previousBranch = state.history.at(-2)?.resultingState
      ?? state.history.at(-1)?.previousState
      ?? ORACLE_CONFIG.entryNode;
    return { resultingState: previousBranch, edgeType: "RETURN" };
  }

  return { resultingState: card.state, edgeType: "PROGRESSION" };
}

function updateSeenCard(card: OracleCard, date: string, id: string, state: OracleState): void {
  const seen = state.cardsSeen[card.id];
  state.cardsSeen[card.id] = seen
    ? { ...seen, lastSeen: date, timesSeen: seen.timesSeen + 1 }
    : { firstSeen: date, lastSeen: date, timesSeen: 1 };

  if (card.rarity === "ANOMALY" && !state.foundAnomalies.includes(card.id)) {
    state.foundAnomalies.push(card.id);
    state.graph.events.push({
      id: `event:${id}:anomaly:${card.id}`,
      drawId: id,
      date,
      type: "ANOMALY_FOUND",
      cardId: card.id,
    });
  }
}

export function drawDailyCard(
  sourceState: OracleState,
  date = localDateKey(),
  random?: () => number,
): DrawResult {
  if (sourceState.lastDate === date) {
    throw new Error("A card has already been drawn for this date.");
  }

  const state = structuredClone(sourceState);
  const journeyRandom = random ?? randomForJourney(state, date);
  const previousState = state.currentNode;
  const previousDrawId = state.history.at(-1)?.id ?? null;
  const sequence = state.history.length + 1;
  const { card, targetState } = selectCard(state, journeyRandom);
  if (usesConditionBypass(card, state)) state.conditionBypassDraws -= 1;
  const id = drawId(date, sequence, card.id);
  const { resultingState, edgeType } = applyGraphEffect(card, state, id, date, journeyRandom);
  const record: DrawRecord = {
    id,
    sequence,
    date,
    cardId: card.id,
    previousDrawId,
    previousState,
    targetState,
    state: card.state,
    resultingState,
    theme: card.theme,
    rarity: card.rarity,
    deckVersion: ORACLE_CONFIG.deckVersion,
    algorithmVersion: ORACLE_CONFIG.algorithmVersion,
  };

  state.currentNode = resultingState;
  state.history.push(record);
  state.graph.edges.push({
    id: `edge:${id}`,
    fromDrawId: previousDrawId,
    toDrawId: id,
    fromState: previousState,
    toState: resultingState,
    type: edgeType,
  });
  state.streak = isYesterday(state.lastDate, date) ? state.streak + 1 : 1;
  state.lastDate = date;
  state.daysWithoutRare = RARE_RARITIES.has(card.rarity) ? 0 : state.daysWithoutRare + 1;
  state.deckVersion = ORACLE_CONFIG.deckVersion;
  state.algorithmVersion = ORACLE_CONFIG.algorithmVersion;
  updateSeenCard(card, date, id, state);

  return { card, record, state };
}
