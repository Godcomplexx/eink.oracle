import {
  createHoloCard,
  type HoloCard,
  type HoloEffect,
  type PaletteOptions,
} from "@kongyo2/cards-css";
import "@kongyo2/cards-css/styles.css";
import "./styles.css";

import { drawDailyCard, localDateKey } from "./oracle";
import { loadState, saveState } from "./storage";
import type { DrawRecord, OracleCard, OracleState, Rarity } from "./types";

import cardBackUrl from "./assets/ui/card-back.webp";
import handUrl from "./assets/ui/hand.webp";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("App root was not found.");
const app = appRoot;

type ColorTheme = "dark" | "light";

const THEME_STORAGE_KEY = "your-own-houdini:color-theme";

function storedColorTheme(): ColorTheme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

function preferredColorTheme(): ColorTheme {
  return storedColorTheme() ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

let colorTheme = preferredColorTheme();

function updateThemeControl(): void {
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (!button) return;

  const nextTheme = colorTheme === "dark" ? "light" : "dark";
  button.setAttribute("aria-label", `Use ${nextTheme} theme`);
  button.setAttribute("title", `Use ${nextTheme} theme`);
  button.querySelector<HTMLElement>(".theme-toggle__label")!.textContent = nextTheme.toUpperCase();
  button.querySelector<HTMLElement>(".theme-toggle__icon")!.textContent = colorTheme === "dark" ? "☼" : "◐";
}

function applyColorTheme(theme: ColorTheme, persist = false): void {
  colorTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#090a08" : "#f0efe9",
  );

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for this page when storage is unavailable.
    }
  }

  updateThemeControl();
}

function bindThemeControl(): void {
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (!button) return;

  updateThemeControl();
  button.addEventListener("click", () => {
    applyColorTheme(colorTheme === "dark" ? "light" : "dark", true);
  });
}

applyColorTheme(colorTheme);

let state = loadState();
let activeHolo: HoloCard | null = null;
const DEFAULT_CARD_ASPECT_RATIO = 952 / 1652;

const EFFECT_BY_RARITY: Record<Rarity, HoloEffect> = {
  COMMON: "none",
  RARE: "rainbow",
  ARCANE: "crystal",
  ANOMALY: "oilslick",
  HOUDINI: "holo",
};

const PALETTE_BY_RARITY: Record<Rarity, PaletteOptions> = {
  COMMON: { preset: "mono", edge: "#d8d5c8", glow: "#f0eee3" },
  RARE: { preset: "rainbow", edge: "#f1ead7", glow: "#bed8ff" },
  ARCANE: { preset: "sapphire", edge: "#d9e8ff", glow: "#91bfff" },
  ANOMALY: {
    preset: "aurora",
    edge: "#e9ffca",
    glow: "#baff89",
    sunpillars: ["#9dffbf", "#c2a4ff", "#f4ff73", "#71d7ff", "#ffffff", "#b4ff82"],
  },
  HOUDINI: { preset: "ruby", edge: "#eadfd9", glow: "#b77d78" },
};

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function placeholderArt(card: OracleCard): string {
  const symbol = escapeXml(card.symbol);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 952 1652">
      <rect width="952" height="1652" fill="#090a08"/>
      <g fill="none" stroke="#deddd3" stroke-width="2" opacity=".82">
        <rect x="24" y="24" width="904" height="1604"/>
        <rect x="44" y="44" width="864" height="1564" opacity=".35"/>
        <circle cx="476" cy="826" r="278" opacity=".32"/>
        <circle cx="476" cy="826" r="214" opacity=".18"/>
        <path d="M92 230H860M92 1422H860M476 116V1536" opacity=".16"/>
        <path d="M82 82l92 92M870 82l-92 92M82 1570l92-92M870 1570l-92-92"/>
      </g>
      <g fill="#deddd3" text-anchor="middle">
        <text x="476" y="880" font-family="Georgia, serif" font-size="230">${symbol}</text>
        <text x="476" y="1360" font-family="Arial, sans-serif" font-size="18" letter-spacing="12" opacity=".72">EINK.ORACLE</text>
      </g>
      <filter id="noise"><feTurbulence baseFrequency=".72" numOctaves="4" stitchTiles="stitch"/></filter>
      <rect width="952" height="1652" filter="url(#noise)" opacity=".08"/>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function seedFromId(id: string): number {
  return Array.from(id).reduce((seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0, 17);
}

function dayLabel(day: number): string {
  return String(day).padStart(3, "0");
}

function isReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function destroyHolo(): void {
  activeHolo?.destroy();
  activeHolo = null;
}

function shell(content: string, screenClass: string): void {
  destroyHolo();
  app.innerHTML = `
    <div class="app-shell">
      <header class="site-header">
        <a class="wordmark" href="./" aria-label="Your Own Houdini home">
          <span>YOUR OWN HOUDINI</span>
        </a>
        <div class="site-header__tools">
          <div class="site-header__status">
            <span>LOCAL MEMORY</span><span class="status-light" aria-hidden="true"></span><span>NO ACCOUNT</span>
          </div>
          <button class="theme-toggle" id="theme-toggle" type="button">
            <span class="theme-toggle__icon" aria-hidden="true"></span>
            <span class="theme-toggle__label"></span>
          </button>
        </div>
      </header>
      <main class="site-main ${screenClass}" id="main-content" aria-live="polite">
        ${content}
      </main>
    </div>`;

  bindThemeControl();
}

function renderLanding(): void {
  const nextDay = state.history.length + 1;
  shell(
    `
      <section class="hero-copy" aria-labelledby="page-title">
        <p class="eyebrow"><span>DAY ${dayLabel(nextDay)}</span><span>ONE DRAW / LOCAL TIME</span></p>
        <h1 id="page-title"><span>YOUR OWN</span> HOUDINI</h1>
        <p class="manifesto">No prophecy.<br />Just a card you probably needed today.</p>
        <p class="hero-note">A machine with no access to the future.<br />Your reaction remains unverified.</p>
        <button class="reveal-button" id="reveal-card" type="button">
          <span>REVEAL YOUR CARD</span>
          <img class="reveal-button__hand" src="${handUrl}" alt="" aria-hidden="true" />
        </button>
        <p class="local-note"><span aria-hidden="true">●</span> Saved only in this browser</p>
        <div class="reveal-progress" aria-hidden="true">
          <span>READING THE GRAPH</span>
          <div class="reveal-progress__line"><i></i></div>
          <span>NO SPIRITS CONTACTED</span>
        </div>
      </section>`,
    "landing-screen",
  );

  document.querySelector<HTMLButtonElement>("#reveal-card")?.addEventListener("click", handleReveal);
}

function preloadImage(src: string | undefined): Promise<number | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0
      ? image.naturalWidth / image.naturalHeight
      : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function handleReveal(event: MouseEvent): Promise<void> {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  button.querySelector("span")!.textContent = "SELECTING A PATH";
  document.querySelector(".landing-screen")?.classList.add("landing-screen--revealing");

  try {
    const today = localDateKey();
    const result = drawDailyCard(state, today);
    saveState(result.state);
    state = result.state;

    const artReady = preloadImage(result.card.art);
    let cardAspectRatio: number | null;
    if (!isReducedMotion()) {
      [, cardAspectRatio] = await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, 850)),
        artReady,
      ]);
    } else {
      cardAspectRatio = await artReady;
    }

    renderCard(result.card, result.record, false, cardAspectRatio ?? DEFAULT_CARD_ASPECT_RATIO);
  } catch (error) {
    console.error(error);
    renderLocked();
  }
}

function makeCardOverlay(card: OracleCard, record: DrawRecord): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = `oracle-card-overlay oracle-card-overlay--${card.rarity.toLowerCase()}`;

  const top = document.createElement("div");
  top.className = "oracle-card-overlay__top";
  top.innerHTML = `<span>DAY ${dayLabel(state.history.length)}</span><span>${card.element}</span>`;

  const bottom = document.createElement("div");
  bottom.className = "oracle-card-overlay__bottom";
  const title = document.createElement("strong");
  title.textContent = card.title;
  const metadata = document.createElement("span");
  metadata.textContent = `${record.state} / ${card.rarity}`;
  bottom.append(title, metadata);

  overlay.append(top, bottom);
  return overlay;
}

function renderCard(card: OracleCard, record: DrawRecord, restored: boolean, cardAspectRatio: number): void {
  const seen = state.cardsSeen[card.id];
  shell(
    `
      <section class="reveal-copy">
        <p class="eyebrow"><span>DAY ${dayLabel(state.history.length)}</span><span>TODAY'S CARD</span></p>
        <div class="reading-index"><span>${record.state}</span></div>
        <h1>${card.title}</h1>
        <blockquote>${card.message}</blockquote>
        <div class="reading-meta">
          <div><span>ELEMENT</span><strong>${card.element}</strong></div>
          <div><span>OBSERVED</span><strong>${seen?.timesSeen ?? 1}×</strong></div>
          <div><span>STREAK</span><strong>${state.streak} DAY${state.streak === 1 ? "" : "S"}</strong></div>
        </div>
        <p class="reaction-line">The card means nothing until you see yourself in it.</p>
        ${restored ? '<p class="restored-note">SAVED RESULT / THIS CARD WILL NOT CHANGE TODAY</p>' : ""}
      </section>
      <section class="card-stage" aria-label="Your revealed card">
        <div class="card-mount" id="card-mount" style="--oracle-card-aspect: ${cardAspectRatio}">
          <div
            class="card-flip"
            id="card-flip"
            role="button"
            tabindex="0"
            aria-label="Reveal your selected card"
          >
          </div>
        </div>
      </section>`,
    `reveal-screen reveal-screen--sealed rarity-${card.rarity.toLowerCase()}`,
  );

  const screen = document.querySelector<HTMLElement>(".reveal-screen");
  const flip = document.querySelector<HTMLDivElement>("#card-flip");
  if (!screen || !flip) return;

  const reducedMotion = isReducedMotion();
  mountHoloCard(flip, card, record, reducedMotion, cardAspectRatio);
  let revealed = false;

  const reveal = (): void => {
    if (revealed) return;
    revealed = true;

    flip.classList.add("card-flip--revealed");
    screen.classList.remove("reveal-screen--sealed");
    screen.classList.add("reveal-screen--revealed");
    flip.removeAttribute("role");
    flip.removeAttribute("tabindex");
    flip.removeAttribute("aria-label");
  };

  flip.addEventListener("click", reveal, { once: true });
  flip.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    reveal();
  });
}

function mountHoloCard(
  flip: HTMLDivElement,
  card: OracleCard,
  record: DrawRecord,
  reducedMotion: boolean,
  cardAspectRatio: number,
): void {
  activeHolo = createHoloCard({
    image: card.art ?? placeholderArt(card),
    imageAlt: card.imageAlt,
    back: cardBackUrl,
    backAlt: "The back of a Your Own Houdini card",
    overlay: makeCardOverlay(card, record),
    className: "oracle-holo-card",
    effect: EFFECT_BY_RARITY[card.rarity],
    palette: PALETTE_BY_RARITY[card.rarity],
    aspectRatio: cardAspectRatio,
    textureSeed: seedFromId(card.id),
    interactive: !reducedMotion,
    gyroscope: false,
    showcase: reducedMotion
      ? false
      : { delay: 650, duration: 3200, intensity: card.rarity === "ANOMALY" ? 8 : 5 },
    depth: card.rarity === "ARCANE" || card.rarity === "ANOMALY" ? { strength: 8, shadow: 0.3 } : false,
    physics: { maxTilt: 7, parallax: 0.55, glareRange: 0.7, returnDelay: 180 },
    visual: {
      glareOpacity: card.rarity === "COMMON" ? 0.42 : 0.55,
      shineOpacity: card.rarity === "COMMON" ? 0.2 : 0.68,
      saturate: card.rarity === "COMMON" ? 0.48 : 1,
    },
  });
  flip.append(activeHolo.element);
}

function renderLocked(): void {
  const day = Math.max(1, state.history.length);

  shell(
    `
      <section class="locked-copy">
        <p class="eyebrow"><span>DAY ${dayLabel(day)}</span><span>ARCHIVE SEALED</span></p>
        <h1>YOU'VE ALREADY<br />SEEN YOUR FATE<br />TODAY.</h1>
        <p>COME BACK TOMORROW.</p>
      </section>`,
    "locked-screen",
  );
}

if (state.lastDate === localDateKey()) {
  renderLocked();
} else {
  renderLanding();
}

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
  if (!storedColorTheme()) applyColorTheme(event.matches ? "light" : "dark");
});
