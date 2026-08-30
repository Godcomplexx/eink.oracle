import type { OracleCard } from "./types";

type CardRecord = Omit<OracleCard, "art">;

const cardModules = import.meta.glob<CardRecord>("../content/cards/*.json", {
  eager: true,
  import: "default",
});

const artModules = import.meta.glob<string>("./assets/cards/*/card.{avif,webp,png,jpg,jpeg}", {
  eager: true,
  import: "default",
  query: "?url",
});

const artByKey = new Map<string, string>();
for (const [path, url] of Object.entries(artModules)) {
  const imageKey = path.match(/\/cards\/([^/]+)\/card\.[^.]+$/)?.[1];
  if (imageKey) artByKey.set(imageKey, url);
}

export const CARDS: OracleCard[] = Object.entries(cardModules)
  .filter(([, record]) => record.status !== "draft")
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, record]) => {
    const art = record.imageKey ? artByKey.get(record.imageKey) : undefined;
    if (record.imageKey && !art) {
      throw new Error(`Card ${record.id} references missing Vite asset ${record.imageKey} (${path}).`);
    }

    return { ...record, art };
  });
