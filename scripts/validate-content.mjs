import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cardsDirectory = path.join(projectRoot, "content", "cards");
const assetsDirectory = path.join(projectRoot, "src", "assets", "cards");
const cardTypesFile = path.join(projectRoot, "content", "card-types.json");

const rarities = new Set(["COMMON", "RARE", "ARCANE", "ANOMALY", "HOUDINI"]);
const states = new Set(["OPENING", "DISCOVERY", "REFLECTION", "ACTION", "CHANGE", "RELEASE", "RENEWAL"]);
const elements = new Set(["AIR", "WATER", "FIRE", "EARTH", "AETHER"]);
const conditionTypes = new Set(["journey-days", "seen-card", "unlocked-node"]);
const effectTypes = new Set(["none", "unlock-node", "return-to-previous"]);
const imageExtensions = ["avif", "webp", "png", "jpg", "jpeg"];
const visibilityModes = new Set(["PUBLIC", "HIDDEN_UNTIL_DISCOVERED"]);
const cardStatuses = new Set(["draft", "live"]);

const errors = [];
const cardFiles = (await readdir(cardsDirectory)).filter((file) => file.endsWith(".json")).sort();
const cards = [];
let cardTypes;

try {
  cardTypes = JSON.parse(await readFile(cardTypesFile, "utf8"));
} catch (error) {
  errors.push(`card-types.json: invalid JSON (${error.message}).`);
}

function requireString(card, field, file) {
  if (typeof card[field] !== "string" || card[field].trim() === "") {
    errors.push(`${file}: ${field} must be a non-empty string.`);
  }
}

for (const file of cardFiles) {
  const fullPath = path.join(cardsDirectory, file);
  let card;

  try {
    card = JSON.parse(await readFile(fullPath, "utf8"));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message}).`);
    continue;
  }

  cards.push({ card, file });
  for (const field of ["id", "title", "message", "meaning", "theme", "symbol", "imageAlt"]) {
    requireString(card, field, file);
  }

  const expectedId = path.basename(file, ".json");
  if (card.id !== expectedId) errors.push(`${file}: id must match the filename (${expectedId}).`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id ?? "")) errors.push(`${file}: id is not a valid slug.`);
  if (!rarities.has(card.rarity)) errors.push(`${file}: unsupported rarity ${card.rarity}.`);
  if (!states.has(card.state)) errors.push(`${file}: unsupported state ${card.state}.`);
  if (!elements.has(card.element)) errors.push(`${file}: unsupported element ${card.element}.`);
  if (!Number.isInteger(card.cooldown) || card.cooldown < 1) errors.push(`${file}: cooldown must be a positive integer.`);
  if (!Array.isArray(card.tags) || card.tags.length === 0) errors.push(`${file}: tags must be a non-empty array.`);
  if (!Array.isArray(card.nextNodes) || card.nextNodes.some((node) => !states.has(node))) {
    errors.push(`${file}: nextNodes contains an unsupported state.`);
  }
  if (!Array.isArray(card.unlockConditions)) errors.push(`${file}: unlockConditions must be an array.`);
  if (!card.graphEffect || !effectTypes.has(card.graphEffect.type)) {
    errors.push(`${file}: graphEffect is missing or unsupported.`);
  }
  if (card.loreId !== null && typeof card.loreId !== "string") errors.push(`${file}: loreId must be a string or null.`);
  if (card.imageKey !== null && typeof card.imageKey !== "string") errors.push(`${file}: imageKey must be a string or null.`);
  if (card.showcase !== undefined && typeof card.showcase !== "boolean") errors.push(`${file}: showcase must be a boolean.`);
  if (card.visibility !== undefined && !visibilityModes.has(card.visibility)) {
    errors.push(`${file}: visibility must be PUBLIC or HIDDEN_UNTIL_DISCOVERED.`);
  }
  if (card.showcase === true) {
    requireString(card, "mechanic", file);
    if (!visibilityModes.has(card.visibility)) errors.push(`${file}: showcase cards require a visibility mode.`);
    if (card.status === "draft") errors.push(`${file}: a draft card cannot be a type showcase card.`);
  }
  if (card.status !== undefined && !cardStatuses.has(card.status)) {
    errors.push(`${file}: status must be "draft" or "live".`);
  }

  for (const condition of card.unlockConditions ?? []) {
    if (!condition || !conditionTypes.has(condition.type)) {
      errors.push(`${file}: contains an unsupported unlock condition.`);
    }
  }

  if (typeof card.imageKey === "string") {
    let imageFound = false;
    for (const extension of imageExtensions) {
      try {
        await access(path.join(assetsDirectory, card.imageKey, `card.${extension}`), constants.R_OK);
        imageFound = true;
        break;
      } catch {
        // Try the next supported format.
      }
    }
    if (!imageFound) errors.push(`${file}: no Vite asset found for imageKey ${card.imageKey}.`);
  }
}

const cardIds = new Set();
for (const { card, file } of cards) {
  if (cardIds.has(card.id)) errors.push(`${file}: duplicate card id ${card.id}.`);
  cardIds.add(card.id);
}

if (!cardTypes || cardTypes.version !== 1 || !Array.isArray(cardTypes.types)) {
  errors.push("card-types.json: expected version 1 and a types array.");
} else {
  const typeIds = new Set();
  for (const type of cardTypes.types) {
    if (!rarities.has(type.id)) errors.push(`card-types.json: unsupported type ${type.id}.`);
    if (typeIds.has(type.id)) errors.push(`card-types.json: duplicate type ${type.id}.`);
    typeIds.add(type.id);
    if (typeof type.description !== "string" || type.description.trim() === "") {
      errors.push(`card-types.json: ${type.id} requires a description.`);
    }
    if (type.countVisibility !== "VISIBLE" && type.countVisibility !== "HIDDEN") {
      errors.push(`card-types.json: ${type.id} has an unsupported countVisibility.`);
    }

    const showcase = cards.find(({ card }) => card.id === type.showcaseCardId)?.card;
    if (!showcase) {
      errors.push(`card-types.json: ${type.id} references unknown showcase card ${type.showcaseCardId}.`);
    } else if (showcase.rarity !== type.id || showcase.showcase !== true) {
      errors.push(`card-types.json: ${type.showcaseCardId} must be a ${type.id} showcase card.`);
    }
  }

  for (const rarity of rarities) {
    if (!typeIds.has(rarity)) errors.push(`card-types.json: missing type ${rarity}.`);
  }
}

for (const { card, file } of cards) {
  for (const condition of card.unlockConditions ?? []) {
    if (condition.type === "seen-card" && !cardIds.has(condition.cardId)) {
      errors.push(`${file}: unlock condition references unknown card ${condition.cardId}.`);
    }
  }
}

if (cards.length === 0) errors.push("No card JSON files were found.");

if (errors.length > 0) {
  console.error(`Card content validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const withArt = cards.filter(({ card }) => typeof card.imageKey === "string").length;
  const draftCount = cards.filter(({ card }) => card.status === "draft").length;
  const draftNote = draftCount > 0 ? `, ${draftCount} draft (excluded from the live pool)` : "";
  console.log(`Validated ${cards.length} cards (${withArt} with production artwork${draftNote}).`);
}
