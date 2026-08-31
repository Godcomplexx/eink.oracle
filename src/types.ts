export const JOURNEY_STATES = [
  "OPENING",
  "DISCOVERY",
  "REFLECTION",
  "ACTION",
  "CHANGE",
  "RELEASE",
  "RENEWAL",
] as const;

export const RARITIES = ["COMMON", "RARE", "ARCANE", "ANOMALY", "HOUDINI"] as const;

export type JourneyState = (typeof JOURNEY_STATES)[number];
export type Rarity = (typeof RARITIES)[number];
export type CardVisibility = "PUBLIC" | "HIDDEN_UNTIL_DISCOVERED";
export type CardStatus = "draft" | "live";

export type UnlockCondition =
  | { type: "journey-days"; minimum: number }
  | { type: "seen-card"; cardId: string }
  | { type: "seen-count"; cardId: string; minimum: number }
  | { type: "seen-sequence"; cardIds: string[] }
  | { type: "unlocked-node"; node: string };

export type GraphEffect =
  | { type: "none" }
  | { type: "unlock-node"; node: string }
  | { type: "return-to-previous" }
  | { type: "branch-or-return"; node: string; returnChance: number }
  | { type: "recall-old-state"; minimumAge: number }
  | { type: "grant-bypass"; draws: number };

export interface OracleCard {
  id: string;
  title: string;
  message: string;
  meaning: string;
  rarity: Rarity;
  theme: string;
  state: JourneyState;
  tags: string[];
  loreId: string | null;
  nextNodes: JourneyState[];
  unlockConditions: UnlockCondition[];
  graphEffect: GraphEffect;
  cooldown: number;
  element: "AIR" | "WATER" | "FIRE" | "EARTH" | "AETHER";
  symbol: string;
  imageKey: string | null;
  imageAlt: string;
  entryEligible?: boolean;
  selectionWeight?: number;
  mechanic?: string;
  showcase?: boolean;
  visibility?: CardVisibility;
  status?: CardStatus;
  art?: string;
}

export interface DrawRecord {
  id: string;
  sequence: number;
  date: string;
  cardId: string;
  previousDrawId: string | null;
  previousState: JourneyState;
  targetState: JourneyState;
  state: JourneyState;
  resultingState: JourneyState;
  theme: string;
  rarity: Rarity;
  deckVersion: number;
  algorithmVersion: number;
}

export interface SeenCard {
  firstSeen: string;
  lastSeen: string;
  timesSeen: number;
}

export type JourneyEdgeType = "PROGRESSION" | "RETURN";

export interface JourneyEdge {
  id: string;
  fromDrawId: string | null;
  toDrawId: string;
  fromState: JourneyState;
  toState: JourneyState;
  type: JourneyEdgeType;
}

export type JourneyEvent =
  | {
      id: string;
      drawId: string;
      date: string;
      type: "NODE_UNLOCKED";
      node: string;
    }
  | {
      id: string;
      drawId: string;
      date: string;
      type: "ANOMALY_FOUND";
      cardId: string;
    }
  | {
      id: string;
      drawId: string;
      date: string;
      type: "SET_COMPLETED";
      setId: string;
    }
  | {
      id: string;
      drawId: string;
      date: string;
      type: "CONDITION_BYPASS_GRANTED";
      draws: number;
    };

export interface JourneyGraph {
  edges: JourneyEdge[];
  events: JourneyEvent[];
}

export interface OracleState {
  version: 2;
  deckVersion: number;
  algorithmVersion: number;
  anonymousId: string;
  currentNode: JourneyState;
  history: DrawRecord[];
  lastDate: string | null;
  streak: number;
  daysWithoutRare: number;
  cardsSeen: Record<string, SeenCard>;
  unlockedNodes: string[];
  completedSets: string[];
  foundAnomalies: string[];
  conditionBypassDraws: number;
  graph: JourneyGraph;
}

export interface OracleConfig {
  deckVersion: number;
  algorithmVersion: number;
  entryNode: JourneyState;
  rarityWeights: Record<Rarity, number>;
  pity: Array<{ afterDays: number; multiplier: number }>;
  transitions: Record<JourneyState, Partial<Record<JourneyState, number>>>;
}
