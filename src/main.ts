import {
  createHoloCard,
  type HoloCard,
  type HoloEffect,
  type PaletteOptions,
} from "@kongyo2/cards-css";
import "@kongyo2/cards-css/styles.css";
import "./styles.css";

import { CARDS } from "./cards";
import {
  accountServiceConfigured,
  attachOrRestoreArchive,
  initializeAccountSession,
  observeAccountSession,
  sendPasswordlessLink,
  signOutAccount,
  syncAccountArchive,
} from "./auth";
import { drawDailyCard, localDateKey } from "./oracle";
import { loadState, saveState } from "./storage";
import type { DrawRecord, OracleCard, OracleState, Rarity } from "./types";
import type { User } from "@supabase/supabase-js";

import cardBackUrl from "./assets/ui/card-back.webp";
import handUrl from "./assets/ui/hand.webp";
import aetherElementUrl from "./assets/elements/aether.webp";
import airElementUrl from "./assets/elements/air.webp";
import earthElementUrl from "./assets/elements/earth.webp";
import fireElementUrl from "./assets/elements/fire.webp";
import waterElementUrl from "./assets/elements/water.webp";

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

const ADVANCE_DAY_ON_REFRESH = import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === "true";
const BROWSER_CODE_AUTH = !accountServiceConfigured;
const PREVIEW_DATE_STORAGE_KEY = "your-own-houdini:preview-date";
const BROWSER_ACCOUNT_STORAGE_KEY = "your-own-houdini:browser-account";
const BROWSER_CHALLENGE_STORAGE_KEY = "your-own-houdini:browser-challenge";

interface BrowserAccountRecord {
  id: string;
  email: string;
}

interface BrowserChallenge {
  email: string;
  code: string;
}

function nextDateKey(dateKey: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("-");
}

function initializePreviewDate(lastDrawDate: string | null): string | null {
  if (!ADVANCE_DAY_ON_REFRESH) return null;
  try {
    const storedDate = localStorage.getItem(PREVIEW_DATE_STORAGE_KEY);
    const latestKnownDate = [storedDate, lastDrawDate]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const date = latestKnownDate ? nextDateKey(latestKnownDate) : localDateKey();
    localStorage.setItem(PREVIEW_DATE_STORAGE_KEY, date);
    return date;
  } catch {
    return lastDrawDate ? nextDateKey(lastDrawDate) : localDateKey();
  }
}

function loadBrowserAccount(): User | null {
  if (!BROWSER_CODE_AUTH) return null;
  try {
    const raw = localStorage.getItem(BROWSER_ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<BrowserAccountRecord>;
    if (typeof record.id !== "string" || typeof record.email !== "string") return null;
    return { id: record.id, email: record.email } as User;
  } catch {
    return null;
  }
}

function readBrowserChallenge(): BrowserChallenge | null {
  if (!BROWSER_CODE_AUTH) return null;
  try {
    const raw = localStorage.getItem(BROWSER_CHALLENGE_STORAGE_KEY);
    if (!raw) return null;
    const challenge = JSON.parse(raw) as Partial<BrowserChallenge>;
    return typeof challenge.email === "string" && /^\d{6}$/.test(challenge.code ?? "")
      ? challenge as BrowserChallenge
      : null;
  } catch {
    return null;
  }
}

function createBrowserChallenge(email: string): BrowserChallenge {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const challenge = {
    email,
    code: String(random[0]! % 1_000_000).padStart(6, "0"),
  };
  localStorage.setItem(BROWSER_CHALLENGE_STORAGE_KEY, JSON.stringify(challenge));
  return challenge;
}

let state = loadState();
const previewDate = initializePreviewDate(state.lastDate);
let activeHolo: HoloCard | null = null;
let activeScreenCleanup: (() => void) | null = null;
let journeyViewportPosition = { left: 0, top: 0 };
let accountUser: User | null = loadBrowserAccount();
let accountReady = BROWSER_CODE_AUTH;
let accountArchiveConnected = Boolean(accountUser);
let accountFeedback = "";
let accountInitialization: Promise<void> = Promise.resolve();
const CARD_ASPECT_RATIO = 952 / 1652;

function currentDateKey(): string {
  return previewDate ?? localDateKey();
}

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
  activeScreenCleanup?.();
  activeScreenCleanup = null;
  const route = window.location.hash.replace(/^#/, "") || "draw";
  const accountLabel = accountUser ? "ACCOUNT" : "SAVE ARCHIVE";
  app.innerHTML = `
    <div class="app-shell">
      <header class="site-header">
        <a class="wordmark" href="#draw" aria-label="Your Own Houdini home">
          <span>YOUR OWN HOUDINI</span>
        </a>
        <nav class="site-nav" aria-label="Your archive">
          <a href="#draw" ${route === "draw" ? 'aria-current="page"' : ""}>DRAW</a>
          <a href="#deck" ${route === "deck" ? 'aria-current="page"' : ""}>MY DECK</a>
          <a href="#journey" ${route === "journey" || route.startsWith("card/") ? 'aria-current="page"' : ""}>MY JOURNEY</a>
          <a href="#account" ${route === "account" ? 'aria-current="page"' : ""}>${accountLabel}</a>
        </nav>
        <div class="site-header__tools">
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

function preloadImage(src: string | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!src) {
      resolve();
      return;
    }
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

async function handleReveal(event: MouseEvent): Promise<void> {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  button.querySelector("span")!.textContent = "SELECTING A PATH";
  document.querySelector(".landing-screen")?.classList.add("landing-screen--revealing");

  try {
    await accountInitialization;
    const today = currentDateKey();
    const result = drawDailyCard(state, today);
    saveState(result.state);
    state = result.state;

    if (accountUser) {
      try {
        const synchronized = await syncAccountArchive(state, accountUser);
        state = synchronized.state;
        saveState(state);
        accountArchiveConnected = true;
        accountFeedback = synchronized.source === "remote"
          ? "The saved account observation was restored."
          : "Archive synchronized.";
      } catch (error) {
        console.error(error);
        accountArchiveConnected = false;
        accountFeedback = "The card is saved on this device. Cloud synchronization will retry later.";
      }
    }

    const record = state.history.find((candidate) => candidate.date === today) ?? result.record;
    const card = CARDS.find((candidate) => candidate.id === record.cardId) ?? result.card;

    const artReady = preloadImage(card.art);
    if (!isReducedMotion()) {
      await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, 850)),
        artReady,
      ]);
    } else {
      await artReady;
    }

    renderCard(card, record);
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
  top.innerHTML = `<span>DAY ${dayLabel(record.sequence)}</span><span>${card.element}</span>`;

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

const ELEMENT_ART_URL: Record<OracleCard["element"], string> = {
  AETHER: aetherElementUrl,
  AIR: airElementUrl,
  EARTH: earthElementUrl,
  FIRE: fireElementUrl,
  WATER: waterElementUrl,
};

function elementSymbol(element: OracleCard["element"]): string {
  const art = ELEMENT_ART_URL[element];
  return `<img class="element-symbol element-symbol--art" src="${art}" alt="" aria-hidden="true" />`;
}

function streakMarks(streak: number): string {
  const activeMarks = Math.min(Math.max(streak, 0), 7);
  return Array.from({ length: 7 }, (_, index) => (
    `<i class="${index < activeMarks ? "is-active" : ""}"></i>`
  )).join("");
}

function passwordlessFormMarkup(
  prefix: string,
  buttonLabel: string,
  feedback = "",
  className = "",
): string {
  return `
    <form class="account-form ${className}" id="${prefix}-form">
      <label for="${prefix}-email">EMAIL</label>
      <div class="account-form__row">
        <input id="${prefix}-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="YOU@EXAMPLE.COM" />
        <button type="submit">${buttonLabel}</button>
      </div>
    </form>
    <p class="account-feedback" id="${prefix}-feedback" role="status">${escapeXml(feedback)}</p>`;
}

function bindPasswordlessForm(prefix: string, idleButtonLabel: string): void {
  document.querySelector<HTMLFormElement>(`#${prefix}-form`)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("email") as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>(`#${prefix}-feedback`);
    if (!button || !feedback || !input.validity.valid) {
      input.reportValidity();
      return;
    }

    if (BROWSER_CODE_AUTH) {
      const challenge = createBrowserChallenge(input.value.trim());
      accountFeedback = `Access code created for ${challenge.email}.`;
      form.reset();
      if (window.location.hash === "#account") renderAccount();
      else window.location.hash = "account";
      return;
    }

    button.disabled = true;
    button.textContent = "SENDING LINK";
    feedback.textContent = "";
    try {
      await sendPasswordlessLink(input.value.trim());
      accountFeedback = "Check your email and open the private sign-in link on this device.";
      feedback.textContent = accountFeedback;
      form.reset();
    } catch (error) {
      console.error(error);
      accountFeedback = "The sign-in link could not be sent. Check the address and try again.";
      feedback.textContent = accountFeedback;
      button.disabled = false;
      button.textContent = idleButtonLabel;
    }
  });
}

function firstObservationInvitation(): string {
  if (accountUser || state.history.length !== 1) return "";

  return `
    <aside class="archive-invitation" aria-labelledby="archive-invitation-title">
      <p class="archive-invitation__eyebrow">KEEP THE FIRST TRACE</p>
      <h2 id="archive-invitation-title">YOUR CARD IS ONLY THE BEGINNING.</h2>
      <p>Save this observation to unlock your private deck, history and living journey.</p>
      ${passwordlessFormMarkup("first-archive", "SAVE MY PATH", "", "archive-invitation__form")}
      <small>NO PASSWORD · NO PUBLIC PROFILE · STILL ONE CARD A DAY</small>
    </aside>`;
}

function renderCard(card: OracleCard, record: DrawRecord, openFromArchive = false): void {
  const seen = state.cardsSeen[card.id];
  const observations = seen?.timesSeen ?? 1;
  const observationNote = observations === 1 ? "FIRST SIGHTING" : `${observations} SIGHTINGS`;
  const archiveInvitation = openFromArchive ? "" : firstObservationInvitation();
  shell(
    `
      <section class="reveal-copy">
        <p class="eyebrow"><span>DAY ${dayLabel(record.sequence)}</span><span>${openFromArchive || record.date !== currentDateKey() ? "ARCHIVE RECORD" : "TODAY'S CARD"}</span></p>
        ${openFromArchive ? '<a class="reading-back-link" href="#journey">BACK TO MY JOURNEY</a>' : ""}
        <div class="reading-index"><span>${record.state}</span></div>
        <h1>${card.title}</h1>
        <blockquote>${card.message}</blockquote>
        <div class="reading-meta">
          <div>
            <span class="reading-meta__label">ELEMENT</span>
            <span class="reading-meta__value reading-meta__value--element">${elementSymbol(card.element)}<strong>${card.element}</strong></span>
            <span class="reading-meta__note">CURRENT ELEMENT</span>
          </div>
          <div>
            <span class="reading-meta__label">OBSERVED</span>
            <strong class="reading-meta__value">${String(observations).padStart(2, "0")}</strong>
            <span class="reading-meta__note">${observationNote}</span>
          </div>
          <div>
            <span class="reading-meta__label">STREAK</span>
            <strong class="reading-meta__value">DAY ${String(state.streak).padStart(2, "0")}</strong>
            <span class="streak-track" aria-label="${state.streak} day streak">${streakMarks(state.streak)}</span>
          </div>
        </div>
        <p class="reaction-line">The card means nothing until you see yourself in it.</p>
        ${archiveInvitation}
      </section>
      <section class="card-stage" aria-label="Your revealed card">
        <div class="card-mount" id="card-mount">
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
  mountHoloCard(flip, card, record, reducedMotion);
  bridgeSealedCardPointer(flip, reducedMotion);
  bindPasswordlessForm("first-archive", "SAVE MY PATH");
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

  if (openFromArchive) reveal();
}

function bridgeSealedCardPointer(flip: HTMLDivElement, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const rotator = flip.querySelector<HTMLElement>(".holo-card__rotator");
  if (!rotator) return;

  const forwardToHolo = (event: PointerEvent): void => {
    if (flip.classList.contains("card-flip--revealed")) return;
    const target = event.target;
    if (target instanceof Node && rotator.contains(target)) return;

    rotator.dispatchEvent(new PointerEvent(event.type, {
      bubbles: false,
      cancelable: false,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      buttons: event.buttons,
    }));
  };

  flip.addEventListener("pointermove", forwardToHolo);
  flip.addEventListener("pointerleave", forwardToHolo);
  flip.addEventListener("pointercancel", forwardToHolo);
}

function mountHoloCard(
  flip: HTMLDivElement,
  card: OracleCard,
  record: DrawRecord,
  reducedMotion: boolean,
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
    aspectRatio: CARD_ASPECT_RATIO,
    textureSeed: seedFromId(card.id),
    interactive: !reducedMotion,
    gyroscope: false,
    showcase: false,
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

async function viewTodayCard(button: HTMLButtonElement, card: OracleCard, record: DrawRecord): Promise<void> {
  button.disabled = true;
  button.textContent = "OPENING SAVED CARD";

  await preloadImage(card.art);
  renderCard(card, record);
}

function renderLocked(): void {
  const day = Math.max(1, state.history.length);
  const record = state.history.at(-1);
  const card = record?.date === currentDateKey()
    ? CARDS.find((candidate) => candidate.id === record.cardId)
    : undefined;

  shell(
    `
      <section class="locked-copy">
        <p class="eyebrow"><span>DAY ${dayLabel(day)}</span><span>ARCHIVE SEALED</span></p>
        <h1>YOU'VE ALREADY<br />SEEN YOUR FATE<br />TODAY.</h1>
        ${card ? '<button class="view-card-button" id="view-today-card" type="button">VIEW TODAY\'S CARD</button>' : ""}
        <p>COME BACK TOMORROW.</p>
      </section>`,
    "locked-screen",
  );

  if (card && record) {
    document.querySelector<HTMLButtonElement>("#view-today-card")?.addEventListener("click", (event) => {
      void viewTodayCard(event.currentTarget as HTMLButtonElement, card, record);
    }, { once: true });
  }
}

function renderDeck(): void {
  const observed = state.history.length;
  const discovered = CARDS.filter((card) => Boolean(state.cardsSeen[card.id]));
  const visibleCards = CARDS.filter((card) => (
    card.visibility !== "HIDDEN_UNTIL_DISCOVERED" || Boolean(state.cardsSeen[card.id])
  ));
  const rareDiscovered = discovered.filter((card) => card.rarity !== "COMMON").length;
  const anomalyDiscovered = discovered.filter((card) => card.rarity === "ANOMALY").length;
  const rarityLedger = (["COMMON", "RARE", "ARCANE", "ANOMALY", "HOUDINI"] as Rarity[])
    .map((rarity) => {
      const count = discovered.filter((card) => card.rarity === rarity).length;
      return `<li><span>${rarity}</span><strong>${rarity === "HOUDINI" ? (count > 0 ? count : "?") : count}</strong></li>`;
    })
    .join("");
  const cardGrid = visibleCards
    .map((card, index) => {
      const seen = state.cardsSeen[card.id];
      const image = seen ? (card.art ?? placeholderArt(card)) : cardBackUrl;
      const title = seen ? card.title : "UNKNOWN";
      const details = seen
        ? `${seen.timesSeen} ${seen.timesSeen === 1 ? "OBSERVATION" : "OBSERVATIONS"}`
        : "NOT YET OBSERVED";
      const meaning = card.meaning.split("\n")[0] ?? card.meaning;

      return `
        <article class="deck-card ${seen ? "is-discovered" : "is-unknown"}">
          <div class="deck-card__image">
            <img src="${image}" alt="${seen ? escapeXml(card.imageAlt) : "Unknown card"}" loading="lazy" />
          </div>
          <div class="deck-card__caption">
            <div class="deck-card__scanline">
              <span>${String(index + 1).padStart(2, "0")}${seen ? ` / ${card.rarity}` : " / UNOBSERVED"}</span>
              <span>${details}</span>
            </div>
            <h2>${escapeXml(title)}</h2>
            ${seen ? `
              <blockquote>${escapeXml(card.message)}</blockquote>
              <p class="deck-card__meaning">${escapeXml(meaning)}</p>
              <dl class="deck-card__metadata">
                <div><dt>STATE</dt><dd>${card.state}</dd></div>
                <div><dt>ELEMENT</dt><dd>${card.element}</dd></div>
                <div><dt>FIRST SEEN</dt><dd>${seen.firstSeen}</dd></div>
              </dl>` : `
              <p class="deck-card__unknown-note">No observation has been logged. The archive contains no description.</p>`}
          </div>
        </article>`;
    })
    .join("");

  shell(
    `
      <section class="archive-heading deck-heading">
        <p class="eyebrow"><span>MY DECK</span><span>PRIVATE COLLECTION</span></p>
        <h1>OBSERVED<br />CARDS</h1>
        <div class="archive-summary" aria-label="Collection summary">
          <div><strong>${observed}</strong><span>OBSERVED</span></div>
          <div><strong>${discovered.length}</strong><span>UNIQUE</span></div>
          <div><strong>${rareDiscovered}</strong><span>RARE+</span></div>
          <div><strong>${anomalyDiscovered}</strong><span>ANOMALY</span></div>
        </div>
      </section>
      <section class="deck-ledger" aria-label="Discovered card types">
        <ul>${rarityLedger}</ul>
      </section>
      <section class="deck-grid" aria-label="Your observed cards">
        ${cardGrid || '<p class="archive-empty">YOUR FIRST CARD HAS NOT BEEN OBSERVED.</p>'}
      </section>`,
    "archive-screen deck-screen",
  );
}

const JOURNEY_COLUMN: Record<DrawRecord["state"], number> = {
  OPENING: 1,
  DISCOVERY: 2,
  REFLECTION: 3,
  ACTION: 4,
  CHANGE: 5,
  RELEASE: 6,
  RENEWAL: 7,
};

function journeyEventLabel(drawId: string): string {
  return state.graph.events
    .filter((event) => event.drawId === drawId)
    .map((event) => {
      if (event.type === "NODE_UNLOCKED") return `OPENED ${event.node}`;
      if (event.type === "ANOMALY_FOUND") return "ANOMALY TRACE";
      if (event.type === "CONDITION_BYPASS_GRANTED") return "MISSING CONDITION";
      return `SET ${event.setId}`;
    })
    .join(" · ");
}

interface JourneyPoint {
  record: DrawRecord;
  x: number;
  y: number;
}

interface JourneyLabelPlacement {
  dx: number;
  dy: number;
  side: "left" | "right";
}

interface JourneyLabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxesOverlap(first: JourneyLabelBox, second: JourneyLabelBox, gap = 8): boolean {
  return !(
    first.right + gap < second.left
    || first.left - gap > second.right
    || first.bottom + gap < second.top
    || first.top - gap > second.bottom
  );
}

function journeyLabelPlacements(
  points: JourneyPoint[],
  width: number,
  height: number,
  currentId: string | undefined,
): Map<string, JourneyLabelPlacement> {
  const occupied: JourneyLabelBox[] = [];
  const placements = new Map<string, JourneyLabelPlacement>();
  const nodeBoxes = points.map(({ x, y }) => ({
    left: x - 11,
    right: x + 11,
    top: y - 11,
    bottom: y + 11,
  }));
  const priority = [...points].sort((left, right) => {
    const score = (point: JourneyPoint): number => {
      if (point.record.id === currentId) return 3;
      if (journeyEventLabel(point.record.id)) return 2;
      return point.record.rarity === "COMMON" ? 0 : 1;
    };
    return score(right) - score(left) || left.record.sequence - right.record.sequence;
  });

  for (const point of priority) {
    const card = CARDS.find((candidate) => candidate.id === point.record.cardId);
    const title = card?.title ?? point.record.cardId.toUpperCase();
    const event = journeyEventLabel(point.record.id);
    const labelWidth = Math.min(205, Math.max(112, title.length * 10.5));
    const labelHeight = event ? 47 : 34;
    const preferredSide: JourneyLabelPlacement["side"] = point.x > width - 230
      ? "left"
      : point.x < 230
        ? "right"
        : point.record.sequence % 2 === 0 ? "left" : "right";
    const sides: JourneyLabelPlacement["side"][] = [
      preferredSide,
      preferredSide === "right" ? "left" : "right",
    ];
    const verticalOffsets = [-18, 27, -57, 66, -96, 105, -135, 144];
    let selected: JourneyLabelPlacement | undefined;

    for (const dy of verticalOffsets) {
      for (const side of sides) {
        const dx = side === "right" ? 14 : -14;
        const left = side === "right" ? point.x + dx : point.x + dx - labelWidth;
        const box: JourneyLabelBox = {
          left,
          right: left + labelWidth,
          top: point.y + dy - 11,
          bottom: point.y + dy - 11 + labelHeight,
        };
        const insideGraph = box.left >= 12
          && box.right <= width - 12
          && box.top >= 12
          && box.bottom <= height - 12;
        const coversLabel = occupied.some((candidate) => boxesOverlap(box, candidate));
        const coversNode = nodeBoxes.some((candidate, index) => (
          points[index]?.record.id !== point.record.id && boxesOverlap(box, candidate, 3)
        ));
        if (insideGraph && !coversLabel && !coversNode) {
          selected = { dx, dy, side };
          occupied.push(box);
          break;
        }
      }
      if (selected) break;
    }

    if (!selected) {
      const side = point.x > width / 2 ? "left" : "right";
      selected = { dx: side === "right" ? 14 : -14, dy: -18, side };
    }
    placements.set(point.record.id, selected);
  }

  return placements;
}

function journeyGraphMarkup(): string {
  const states = Object.keys(JOURNEY_COLUMN) as Array<keyof typeof JOURNEY_COLUMN>;
  const pointsPerCurrent = 12;
  const currentCount = Math.max(1, Math.ceil(state.history.length / pointsPerCurrent));
  const width = 1120;
  const height = Math.max(620, 380 + currentCount * 230);
  const centerX = width / 2;
  const currentStartY = (height - (currentCount - 1) * 230) / 2;
  const points: JourneyPoint[] = state.history.map((record, index) => {
    const stateIndex = states.indexOf(record.state);
    const currentIndex = Math.floor(index / pointsPerCurrent);
    const pointInCurrent = index % pointsPerCurrent;
    const currentLength = Math.min(pointsPerCurrent, state.history.length - currentIndex * pointsPerCurrent);
    const currentSpan = currentLength === 1 ? 0 : Math.min(880, (currentLength - 1) * 150);
    const step = currentLength <= 1 ? 0 : currentSpan / (currentLength - 1);
    const directionIndex = currentIndex % 2 === 0 ? pointInCurrent : currentLength - pointInCurrent - 1;
    const seed = seedFromId(record.id);
    const xDrift = ((seed % 1000) / 1000 - 0.5) * 18;
    const yDrift = (((seed >>> 9) % 1000) / 1000 - 0.5) * 22;
    const wave = Math.sin(pointInCurrent * 0.82 + currentIndex * 1.1) * 52;
    const stateDrift = (stateIndex - (states.length - 1) / 2) * 8;
    return {
      record,
      x: centerX - currentSpan / 2 + directionIndex * step + xDrift,
      y: currentStartY + currentIndex * 230 + wave + stateDrift + yDrift,
    };
  });
  const pointById = new Map(points.map((point) => [point.record.id, point]));
  const particles = Array.from({ length: 150 }, (_, index) => {
    const seed = seedFromId(`particle:${index}:${state.anonymousId}`);
    const x = 36 + (seed % Math.max(1, width - 72));
    const y = 36 + ((seed >>> 8) % Math.max(1, height - 72));
    const radius = index % 17 === 0 ? 2.1 : index % 5 === 0 ? 1.25 : 0.75;
    const spectrum = index % 19 === 0 ? "anomaly" : index % 11 === 0 ? "rare" : index % 7 === 0 ? "houdini" : "common";
    return `<circle class="journey-graph__particle rarity-${spectrum}" cx="${x}" cy="${y}" r="${radius}" style="--particle-delay: -${index % 11}s" />`;
  }).join("");
  const edges = state.graph.edges.map((edge) => {
    if (!edge.fromDrawId) return "";
    const from = pointById.get(edge.fromDrawId);
    const to = pointById.get(edge.toDrawId);
    if (!from || !to) return "";
    const offset = ((seedFromId(edge.id) % 41) - 20) * 0.8;
    const middleX = (from.x + to.x) / 2 + offset;
    const middleY = (from.y + to.y) / 2 - offset;
    const path = `M ${from.x} ${from.y} Q ${middleX} ${middleY} ${to.x} ${to.y}`;
    const classes = `rarity-${to.record.rarity.toLowerCase()} ${edge.type === "RETURN" ? "is-return" : ""}`;
    return `
      <path class="journey-graph__stream ${classes}" d="${path}" />
      <path class="journey-graph__edge ${classes}" d="${path}" />`;
  }).join("");
  const currentId = state.history.at(-1)?.id;
  const currentPoint = points.find((point) => point.record.id === currentId);
  const labelPlacements = journeyLabelPlacements(points, width, height, currentId);
  const nodes = points.map(({ record, x, y }) => {
    const card = CARDS.find((candidate) => candidate.id === record.cardId);
    const title = escapeXml(card?.title ?? record.cardId.toUpperCase());
    const event = journeyEventLabel(record.id);
    const isCurrent = record.id === currentId;
    const label = labelPlacements.get(record.id) ?? { dx: 14, dy: -18, side: "right" };
    return `
      <a class="journey-graph__node rarity-${record.rarity.toLowerCase()} ${isCurrent ? "is-current" : ""}" href="#card/${encodeURIComponent(record.id)}" aria-label="Open ${title}, day ${record.sequence}" transform="translate(${x} ${y})">
        <title>Day ${record.sequence}: ${title} — ${record.state}</title>
        <circle class="journey-graph__hit-area" r="16" />
        <circle class="journey-graph__marker" r="${isCurrent ? 5.5 : 4}" />
        <g class="journey-graph__label is-${label.side}" transform="translate(${label.dx} ${label.dy})">
          <text class="journey-graph__label-day">DAY ${dayLabel(record.sequence)} / ${record.state}</text>
          <text class="journey-graph__label-title" y="17">${title}</text>
          ${event ? `<text class="journey-graph__label-event" y="31">${escapeXml(event)}</text>` : ""}
        </g>
      </a>`;
  }).join("");

  return `
    <svg class="journey-graph" viewBox="0 0 ${width} ${height}" data-view-width="${width}" data-view-height="${height}" data-current-x="${currentPoint?.x ?? centerX}" data-current-y="${currentPoint?.y ?? height / 2}" role="img" aria-label="Your personal card journey graph">
      <defs>
        <filter id="journey-fluid-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="42" />
        </filter>
        <filter id="journey-stream-blur" x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <g class="journey-graph__fluid" filter="url(#journey-fluid-blur)" aria-hidden="true">
        <ellipse class="journey-graph__fluid-shape journey-graph__fluid-shape--one" cx="${centerX - 190}" cy="${height * 0.38}" rx="250" ry="120" />
        <ellipse class="journey-graph__fluid-shape journey-graph__fluid-shape--two" cx="${centerX + 210}" cy="${height * 0.62}" rx="230" ry="135" />
      </g>
      <g aria-hidden="true">${particles}</g>
      <g aria-hidden="true">${edges}</g>
      <g>${nodes}</g>
    </svg>`;
}

function renderJourney(): void {
  const rareCount = state.history.filter((record) => record.rarity !== "COMMON").length;
  const graph = state.history.length > 0 ? journeyGraphMarkup() : "";

  shell(
    `
      ${state.history.length > 0 ? `
        <section class="archive-heading journey-heading">
          <p class="eyebrow"><span>MY JOURNEY</span><span>${state.currentNode}</span></p>
          <h1>THE LIVING<br />PATH</h1>
          <p class="journey-intro">Every point is one daily observation. The route grows with you, but predicts nothing.</p>
          <div class="archive-summary journey-summary" aria-label="Journey summary">
            <div><strong>${state.history.length}</strong><span>OBSERVED</span></div>
            <div><strong>${Object.keys(state.cardsSeen).length}</strong><span>UNIQUE</span></div>
            <div><strong>${rareCount}</strong><span>RARE EVENTS</span></div>
            <div><strong>${state.unlockedNodes.length}</strong><span>OPEN PATHS</span></div>
          </div>
        </section>
        <section class="journey-canvas" aria-label="Your card journey observatory">
          <div class="journey-plot__viewport">
            ${graph}
          </div>
          <footer class="journey-canvas__footer">
            <span>OBSERVATION TYPE</span>
            <ul aria-label="Rarity legend">
              <li class="rarity-common"><i></i><span>COMMON</span></li>
              <li class="rarity-rare"><i></i><span>RARE</span></li>
              <li class="rarity-arcane"><i></i><span>ARCANE</span></li>
              <li class="rarity-anomaly"><i></i><span>ANOMALY</span></li>
              <li class="rarity-houdini"><i></i><span>HOUDINI</span></li>
            </ul>
          </footer>
        </section>` : `
        <section class="archive-empty archive-empty--journey">
          <p>THE PATH BEGINS WITH THE FIRST OBSERVATION.</p>
          <a class="view-card-button" href="#draw">DRAW YOUR CARD</a>
        </section>`}
    `,
    "archive-screen journey-screen",
  );

  const viewport = document.querySelector<HTMLElement>(".journey-plot__viewport");
  if (viewport) {
    requestAnimationFrame(() => {
      const hasSavedPosition = journeyViewportPosition.left > 0 || journeyViewportPosition.top > 0;
      if (hasSavedPosition) {
        viewport.scrollLeft = journeyViewportPosition.left;
        viewport.scrollTop = journeyViewportPosition.top;
        return;
      }

      const graph = viewport.querySelector<SVGSVGElement>(".journey-graph");
      const viewWidth = Number(graph?.dataset.viewWidth ?? 0);
      const viewHeight = Number(graph?.dataset.viewHeight ?? 0);
      const currentX = Number(graph?.dataset.currentX ?? viewWidth / 2);
      const currentY = Number(graph?.dataset.currentY ?? viewHeight / 2);
      if (graph && viewWidth > 0 && viewHeight > 0) {
        const renderedWidth = graph.getBoundingClientRect().width;
        const renderedHeight = graph.getBoundingClientRect().height;
        viewport.scrollLeft = Math.max(0, currentX / viewWidth * renderedWidth - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, currentY / viewHeight * renderedHeight - viewport.clientHeight / 2);
      }
    });
    viewport.querySelectorAll<HTMLAnchorElement>(".journey-graph__node").forEach((node) => {
      node.addEventListener("click", () => {
        journeyViewportPosition = { left: viewport.scrollLeft, top: viewport.scrollTop };
      });
    });
  }
}

function renderArchiveGate(destination: "MY DECK" | "MY JOURNEY"): void {
  if (accountServiceConfigured && !accountReady) {
    shell(
      `
        <section class="account-copy archive-gate">
          <p class="eyebrow"><span>${destination}</span><span>CHECKING ARCHIVE</span></p>
          <h1>OPENING<br />THE ARCHIVE</h1>
        </section>`,
      "account-screen archive-gate-screen",
    );
    return;
  }

  const archiveNote = state.history.length > 0
    ? "Your first card is already safe in this browser. Signing in attaches it to your private archive and never grants another daily draw."
    : "Draw your first card without an account. Signing in later attaches that observation and never grants another daily draw.";
  const gateIntro = BROWSER_CODE_AUTH
    ? "Enter your email to receive a six-digit access code on this page and open your private deck, observation history and living graph."
    : "Enter your email to open your private deck, observation history and living graph. Your daily card remains available without an account.";
  const gateButton = BROWSER_CODE_AUTH ? "CONTINUE" : "EMAIL THE PRIVATE LINK";

  shell(
    `
      <section class="account-copy archive-gate">
        <p class="eyebrow"><span>${destination}</span><span>PRIVATE ARCHIVE</span></p>
        <h1>YOUR ARCHIVE<br />IS SEALED</h1>
        <p class="account-intro">${gateIntro}</p>
        ${passwordlessFormMarkup("archive-gate", gateButton)}
        <p class="account-privacy">${archiveNote}</p>
      </section>`,
    "account-screen archive-gate-screen",
  );

  bindPasswordlessForm("archive-gate", gateButton);
}

function renderBrowserVerification(challenge: BrowserChallenge): void {
  const visibleCode = `${challenge.code.slice(0, 3)} ${challenge.code.slice(3)}`;
  shell(
    `
      <section class="account-copy browser-auth">
        <p class="eyebrow"><span>ACCOUNT</span><span>ACCESS CODE</span></p>
        <h1>VERIFY<br />THE ARCHIVE</h1>
        <p class="account-intro">Use the six-digit private code below to continue as ${escapeXml(challenge.email)}.</p>
        <output class="browser-auth__code" aria-label="Verification code">${visibleCode}</output>
        <form class="account-form browser-auth__form" id="browser-code-form">
          <label for="browser-code">SIX-DIGIT CODE</label>
          <div class="account-form__row">
            <input id="browser-code" name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="000000" />
            <button type="submit">OPEN MY ARCHIVE</button>
          </div>
        </form>
        <p class="account-feedback" id="browser-code-feedback" role="status"></p>
        <p class="account-privacy">The code opens your existing archive and never grants another daily card.</p>
      </section>`,
    "account-screen browser-auth-screen",
  );

  document.querySelector<HTMLFormElement>("#browser-code-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("code") as HTMLInputElement;
    const feedback = document.querySelector<HTMLElement>("#browser-code-feedback");
    const code = input.value.replace(/\s/g, "");
    if (!input.validity.valid) {
      input.reportValidity();
      return;
    }
    if (code !== challenge.code) {
      if (feedback) feedback.textContent = "The access code does not match.";
      input.select();
      return;
    }

    const record: BrowserAccountRecord = { id: crypto.randomUUID(), email: challenge.email };
    localStorage.setItem(BROWSER_ACCOUNT_STORAGE_KEY, JSON.stringify(record));
    localStorage.removeItem(BROWSER_CHALLENGE_STORAGE_KEY);
    accountUser = { id: record.id, email: record.email } as User;
    accountArchiveConnected = true;
    accountFeedback = "Archive unlocked. Your existing cards and journey are attached.";
    renderAccount();
  });
}

function renderAccount(): void {
  if (!accountReady) {
    shell(
      `
        <section class="account-copy">
          <p class="eyebrow"><span>ACCOUNT</span><span>CHECKING SESSION</span></p>
          <h1>OPENING<br />THE ARCHIVE</h1>
        </section>`,
      "account-screen",
    );
    return;
  }

  if (accountUser) {
    const email = escapeXml(accountUser.email ?? "PRIVATE ACCOUNT");
    shell(
      `
        <section class="account-copy account-copy--connected">
          <p class="eyebrow"><span>ACCOUNT</span><span>${BROWSER_CODE_AUTH ? "ARCHIVE SAVED" : accountArchiveConnected ? "ARCHIVE SYNCED" : "SYNC PENDING"}</span></p>
          <h1>YOUR PATH<br />IS SAVED</h1>
          <p class="account-intro">${BROWSER_CODE_AUTH ? "Your cards and journey are attached to this browser archive. This account stores no public profile." : "Your cards and journey can now follow you to another device. This account stores no public profile."}</p>
          <dl class="account-details">
            <div><dt>SIGN-IN EMAIL</dt><dd>${email}</dd></div>
            <div><dt>OBSERVATIONS</dt><dd>${state.history.length}</dd></div>
            <div><dt>UNIQUE CARDS</dt><dd>${Object.keys(state.cardsSeen).length}</dd></div>
            <div><dt>STORAGE</dt><dd>${BROWSER_CODE_AUTH ? "THIS BROWSER" : "PRIVATE"}</dd></div>
          </dl>
          ${accountFeedback ? `<p class="account-feedback" role="status">${escapeXml(accountFeedback)}</p>` : ""}
          <button class="account-secondary-button" id="account-sign-out" type="button">SIGN OUT ON THIS DEVICE</button>
        </section>`,
      "account-screen",
    );

    document.querySelector<HTMLButtonElement>("#account-sign-out")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "SIGNING OUT";
      try {
        if (BROWSER_CODE_AUTH) {
          localStorage.removeItem(BROWSER_ACCOUNT_STORAGE_KEY);
          localStorage.removeItem(BROWSER_CHALLENGE_STORAGE_KEY);
        } else {
          await signOutAccount();
        }
        accountUser = null;
        accountArchiveConnected = false;
        accountFeedback = BROWSER_CODE_AUTH
          ? "Account closed. The browser archive remains available."
          : "Cloud archive disconnected. The current browser copy remains available.";
        renderAccount();
      } catch (error) {
        console.error(error);
        accountFeedback = "Could not sign out. Please try again.";
        renderAccount();
      }
    }, { once: true });
    return;
  }

  if (BROWSER_CODE_AUTH) {
    const challenge = readBrowserChallenge();
    if (challenge) {
      renderBrowserVerification(challenge);
      return;
    }

    shell(
      `
        <section class="account-copy browser-auth">
          <p class="eyebrow"><span>ACCOUNT</span><span>PASSWORDLESS</span></p>
          <h1>SAVE YOUR<br />ARCHIVE</h1>
          <p class="account-intro">Enter your email address. A private six-digit access code will appear on this page.</p>
          ${passwordlessFormMarkup("account", "CONTINUE", accountFeedback)}
          <p class="account-privacy">After verification, MY DECK and MY JOURNEY will open. An account never grants another daily card.</p>
        </section>`,
      "account-screen browser-auth-screen",
    );
    bindPasswordlessForm("account", "CONTINUE");
    return;
  }

  shell(
    `
      <section class="account-copy">
        <p class="eyebrow"><span>ACCOUNT</span><span>PASSWORDLESS</span></p>
        <h1>SAVE YOUR<br />ARCHIVE</h1>
        <p class="account-intro">Enter one email address. We will send a private sign-in link — no password, username, phone number or public profile.</p>
        ${passwordlessFormMarkup("account", "EMAIL THE SIGN-IN LINK", accountFeedback)}
        <p class="account-privacy">Your existing browser archive will be attached after the first sign-in. An account does not grant another daily card.</p>
      </section>`,
    "account-screen",
  );

  bindPasswordlessForm("account", "EMAIL THE SIGN-IN LINK");
}

function renderDrawRoute(): void {
  if (state.lastDate === currentDateKey()) renderLocked();
  else renderLanding();
}

function renderRoute(): void {
  const route = window.location.hash.replace(/^#/, "");
  if (route.startsWith("card/")) {
    if (!accountUser) {
      renderArchiveGate("MY JOURNEY");
      return;
    }
    let drawId = "";
    try {
      drawId = decodeURIComponent(route.slice("card/".length));
    } catch {
      window.location.hash = "journey";
      return;
    }
    const record = state.history.find((candidate) => candidate.id === drawId);
    const card = record ? CARDS.find((candidate) => candidate.id === record.cardId) : undefined;
    if (record && card) {
      renderCard(card, record, true);
      return;
    }
    window.location.hash = "journey";
    return;
  }
  if (route === "deck") {
    if (accountUser) renderDeck();
    else renderArchiveGate("MY DECK");
    return;
  }
  if (route === "journey") {
    if (accountUser) renderJourney();
    else renderArchiveGate("MY JOURNEY");
    return;
  }
  if (route === "account") {
    renderAccount();
    return;
  }
  renderDrawRoute();
}

renderRoute();
window.addEventListener("hashchange", renderRoute);

async function startAccountIntegration(): Promise<void> {
  if (BROWSER_CODE_AUTH) return;
  try {
    accountUser = await initializeAccountSession();
    if (accountUser) {
      const synchronized = await attachOrRestoreArchive(state, accountUser);
      state = synchronized.state;
      saveState(state);
      accountArchiveConnected = true;
      accountFeedback = synchronized.source === "remote"
        ? "Account archive restored on this device."
        : "Browser archive saved to your account.";
    }
  } catch (error) {
    console.error(error);
    accountArchiveConnected = false;
    accountFeedback = "Account service is temporarily unavailable. Your browser archive is safe.";
  } finally {
    accountReady = true;
    renderRoute();
  }

  observeAccountSession((event, session) => {
    if (event === "SIGNED_OUT") {
      accountUser = null;
      accountArchiveConnected = false;
      renderRoute();
      return;
    }

    if (event === "SIGNED_IN" && session?.user && session.user.id !== accountUser?.id) {
      accountUser = session.user;
      void attachOrRestoreArchive(state, accountUser)
        .then((synchronized) => {
          state = synchronized.state;
          saveState(state);
          accountArchiveConnected = true;
          accountFeedback = synchronized.source === "remote"
            ? "Account archive restored on this device."
            : "Browser archive saved to your account.";
          renderRoute();
        })
        .catch((error) => {
          console.error(error);
          accountArchiveConnected = false;
          accountFeedback = "Signed in, but archive synchronization needs to be retried.";
          renderRoute();
        });
    }
  });
}

accountInitialization = startAccountIntegration();

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
  if (!storedColorTheme()) applyColorTheme(event.matches ? "light" : "dark");
});
