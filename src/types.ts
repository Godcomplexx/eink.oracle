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
  | { type: "unlocked-node"; node: string };

export type GraphEffect =
  | { type: "none" }
  | { type: "unlock-node"; node: string }
  | { type: "return-to-previous" };

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
  mechanic?: string;
  showcase?: boolean;
  visibility?: CardVisibility;
  status?: CardStatus;
  art?: string;
}

export interface DrawRecord {
  date: string;
  cardId: string;
  state: JourneyState;
  theme: string;
  rarity: Rarity;
}

export interface SeenCard {
  firstSeen: string;
  lastSeen: string;
  timesSeen: number;
}

export interface OracleState {
  version: 1;
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
}
