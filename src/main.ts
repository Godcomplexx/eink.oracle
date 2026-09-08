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
  accountConnectionSecure,
  accountServiceConfigured,
  attachOrRestoreArchive,
  initializeAccountSession,
  observeAccountSession,
  registerWithPassword,
  sendPasswordRecoveryCode,
  signInWithPassword,
  signOutAccount,
  syncAccountArchive,
  updateAccountPassword,
  verifyPasswordRecoveryCode,
  verifyRegistrationCode,
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
const BROWSER_ID_STORAGE_KEY = "your-own-houdini:browser-id:v1";
const BROWSER_DRAWS_STORAGE_KEY = "your-own-houdini:browser-draws:v1";

function loadBrowserId(): string {
  try {
    const stored = localStorage.getItem(BROWSER_ID_STORAGE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(BROWSER_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function loadBrowserDraws(): Record<string, string> {
  try {
    const stored = localStorage.getItem(BROWSER_DRAWS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

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
  button.querySelector<HTMLElement>(".theme-toggle__icon")!.innerHTML = colorTheme === "dark"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.55 1.55M17.55 17.55l1.55 1.55M19.1 4.9l-1.55 1.55M6.45 17.55 4.9 19.1" />
      </svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.3 15.1A8 8 0 0 1 8.9 4.7 8.1 8.1 0 1 0 19.3 15.1Z" />
      </svg>`;
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

const PENDING_AUTH_STORAGE_KEY = "your-own-houdini:pending-auth:v1";

type PendingAuthPurpose = "registration" | "recovery";
type AccountView = "sign-in" | "register" | "forgot" | "change-password";

interface PendingAuth {
  email: string;
  purpose: PendingAuthPurpose;
}

function readPendingAuth(): PendingAuth | null {
  try {
    const stored = sessionStorage.getItem(PENDING_AUTH_STORAGE_KEY);
    if (!stored) return null;
    const pending = JSON.parse(stored) as Partial<PendingAuth>;
    if (
      typeof pending.email !== "string"
      || (pending.purpose !== "registration" && pending.purpose !== "recovery")
    ) return null;
    return pending as PendingAuth;
  } catch {
    return null;
  }
}

function rememberPendingAuth(pending: PendingAuth): void {
  try {
    sessionStorage.setItem(PENDING_AUTH_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // The confirmation form remains available for the current page.
  }
}

function clearPendingAuth(): void {
  try {
    sessionStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
  } catch {
    // Nothing else needs to be cleared.
  }
}

let state = loadState();
const browserId = loadBrowserId();
const browserDraws = loadBrowserDraws();
if (Object.keys(browserDraws).length === 0 && state.lastDate) {
  const legacyBrowserRecord = [...state.history].reverse().find((record) => record.date === state.lastDate);
  if (legacyBrowserRecord) {
    browserDraws[state.lastDate] = legacyBrowserRecord.id;
    try {
      localStorage.setItem(BROWSER_DRAWS_STORAGE_KEY, JSON.stringify(browserDraws));
    } catch {
      // The in-memory browser limit still applies for this visit.
    }
  }
}
let activeHolo: HoloCard | null = null;
let activeScreenCleanup: (() => void) | null = null;
let journeyViewportPosition = { left: 0, top: 0 };
let accountUser: User | null = null;
let accountReady = !accountServiceConfigured;
let accountArchiveConnected = false;
let accountFeedback = "";
let accountView: AccountView = "sign-in";
let accountInitialization: Promise<void> = Promise.resolve();
let accountConnection: { userId: string; promise: Promise<void> } | null = null;
const CARD_ASPECT_RATIO = 952 / 1652;

function rememberBrowserDraw(date: string, drawId: string): void {
  browserDraws[date] = drawId;
  try {
    localStorage.setItem(BROWSER_DRAWS_STORAGE_KEY, JSON.stringify(browserDraws));
  } catch {
    // The in-memory browser limit still applies for this visit.
  }
}

function currentDateKey(): string {
  return localDateKey();
}

async function connectAccountUser(user: User): Promise<void> {
  if (accountConnection?.userId === user.id) return accountConnection.promise;

  const promise = (async () => {
    accountUser = user;
    const synchronized = await attachOrRestoreArchive(state, user);
    state = synchronized.state;
    saveState(state);
    accountArchiveConnected = true;
    accountFeedback = synchronized.source === "remote"
      ? "Account archive restored on this device."
      : "Browser archive saved to your account.";
  })();

  accountConnection = { userId: user.id, promise };
  try {
    await promise;
  } catch (error) {
    accountArchiveConnected = false;
    throw error;
  } finally {
    if (accountConnection?.promise === promise) accountConnection = null;
  }
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
    const result = drawDailyCard(state, today, undefined, {
      allowSameDate: true,
      originId: browserId,
    });
    rememberBrowserDraw(today, result.record.id);
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

    const record = state.history.find((candidate) => candidate.id === result.record.id) ?? result.record;
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

function signInFormMarkup(prefix: string, feedback = ""): string {
  return `
    <form class="account-form" id="${prefix}-form">
      <div class="account-form__fields">
        <label class="account-form__field" for="${prefix}-email">
          <span>EMAIL</span>
          <input id="${prefix}-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="YOU@EXAMPLE.COM" />
        </label>
        <label class="account-form__field" for="${prefix}-password">
          <span>PASSWORD</span>
          <input id="${prefix}-password" name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="••••••••" />
        </label>
      </div>
      <button class="account-form__submit" type="submit">OPEN MY ARCHIVE</button>
    </form>
    <p class="account-feedback" id="${prefix}-feedback" role="status">${escapeXml(feedback)}</p>
    <div class="account-auth-links">
      <button type="button" data-account-view="register">CREATE ACCOUNT</button>
      <button type="button" data-account-view="forgot">FORGOT PASSWORD</button>
    </div>`;
}

function bindAccountViewButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-account-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.accountView;
      if (view === "sign-in" || view === "register" || view === "forgot" || view === "change-password") {
        accountView = view;
      }
      accountFeedback = "";
      clearPendingAuth();
      if (window.location.hash === "#account") renderAccount();
      else window.location.hash = "account";
    });
  });
}

function bindSignInForm(prefix: string): void {
  document.querySelector<HTMLFormElement>(`#${prefix}-form`)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>(`#${prefix}-feedback`);
    if (!button || !feedback || !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    button.disabled = true;
    button.textContent = "OPENING ARCHIVE";
    feedback.textContent = "";
    try {
      const user = await signInWithPassword(emailInput.value.trim(), passwordInput.value);
      await connectAccountUser(user);
      accountFeedback = "Archive unlocked on this device.";
      renderRoute();
    } catch (error) {
      console.error(error);
      accountFeedback = "The email or password is incorrect. If this account previously used email codes, choose FORGOT PASSWORD to create a password.";
      feedback.textContent = accountFeedback;
      button.disabled = false;
      button.textContent = "OPEN MY ARCHIVE";
    }
  });
  bindAccountViewButtons();
}

function firstObservationInvitation(): string {
  if (accountUser || state.history.length !== 1) return "";

  return `
    <aside class="archive-invitation" aria-labelledby="archive-invitation-title">
      <p class="archive-invitation__eyebrow">KEEP THE FIRST TRACE</p>
      <h2 id="archive-invitation-title">YOUR CARD IS ONLY THE BEGINNING.</h2>
      <p>Save this observation to unlock your private deck, history and living journey.</p>
      <a class="account-secondary-button archive-invitation__button" href="#account">CREATE MY ARCHIVE</a>
      <small>PRIVATE ACCOUNT · NO PUBLIC PROFILE · ONE OBSERVATION PER BROWSER</small>
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
  const browserDrawId = browserDraws[currentDateKey()];
  const record = browserDrawId
    ? state.history.find((candidate) => candidate.id === browserDrawId)
    : undefined;
  const day = Math.max(1, record?.sequence ?? state.history.length);
  const card = record ? CARDS.find((candidate) => candidate.id === record.cardId) : undefined;

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
  const auraRadius: Record<Rarity, number> = {
    COMMON: 92,
    RARE: 112,
    ARCANE: 132,
    ANOMALY: 142,
    HOUDINI: 126,
  };
  const auras = points.map(({ record, x, y }, index) => {
    const seed = seedFromId(`aura:${record.id}`);
    const driftX = (seed % 35) - 17;
    const driftY = ((seed >>> 7) % 31) - 15;
    const radius = auraRadius[record.rarity] + (record.id === state.history.at(-1)?.id ? 16 : 0);
    return `<circle class="journey-graph__aura rarity-${record.rarity.toLowerCase()}" cx="${x}" cy="${y}" r="${radius}" style="--aura-delay: -${index % 13}s; --aura-x: ${driftX}px; --aura-y: ${driftY}px" />`;
  }).join("");
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
        <filter id="journey-aura-blur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="48" />
        </filter>
        <filter id="journey-stream-blur" x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <g class="journey-graph__auras" filter="url(#journey-aura-blur)" aria-hidden="true">${auras}</g>
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
          <p class="journey-intro">Every point is one browser's daily observation. Separate paths can meet in the same archive.</p>
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
  if (!accountServiceConfigured) {
    shell(
      `
        <section class="account-copy archive-gate">
          <p class="eyebrow"><span>${destination}</span><span>ACCOUNT UNAVAILABLE</span></p>
          <h1>YOUR ARCHIVE<br />IS SAFE HERE</h1>
          <p class="account-intro">The private account service is temporarily unavailable. Your browser copy has not been removed.</p>
        </section>`,
      "account-screen archive-gate-screen",
    );
    return;
  }

  if (!accountConnectionSecure) {
    shell(
      `
        <section class="account-copy archive-gate">
          <p class="eyebrow"><span>${destination}</span><span>SECURE CONNECTION REQUIRED</span></p>
          <h1>THE ARCHIVE<br />STAYS SEALED</h1>
          <p class="account-intro">Do not enter a password until this site has a valid HTTPS certificate. Your browser copy remains safe.</p>
        </section>`,
      "account-screen archive-gate-screen",
    );
    return;
  }

  if (!accountReady) {
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
    ? "Your first card is already safe in this browser. Signing in attaches it to your private archive."
    : "Draw your first card without an account. Signing in later attaches that observation to your growing archive.";

  shell(
    `
      <section class="account-copy archive-gate">
        <p class="eyebrow"><span>${destination}</span><span>PRIVATE ARCHIVE</span></p>
        <h1>YOUR ARCHIVE<br />IS SEALED</h1>
        <p class="account-intro">Sign in with your email and password to open your private deck, observation history and living graph.</p>
        ${signInFormMarkup("archive-gate")}
        <p class="account-privacy">${archiveNote}</p>
      </section>`,
    "account-screen archive-gate-screen",
  );

  bindSignInForm("archive-gate");
}

function renderPendingAuth(pending: PendingAuth): void {
  const isRegistration = pending.purpose === "registration";
  shell(
    `
      <section class="account-copy browser-auth">
        <p class="eyebrow"><span>ACCOUNT</span><span>${isRegistration ? "CONFIRM EMAIL" : "RECOVER PASSWORD"}</span></p>
        <h1>${isRegistration ? "VERIFY<br />THE ARCHIVE" : "RESET<br />THE PASSWORD"}</h1>
        <p class="account-intro">We sent a one-time code to ${escapeXml(pending.email)}.</p>
        <form class="account-form browser-auth__form" id="pending-auth-form">
          <div class="account-form__fields ${isRegistration ? "account-form__fields--single" : ""}">
            <label class="account-form__field" for="pending-auth-code">
              <span>ACCESS CODE</span>
              <input id="pending-auth-code" name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required placeholder="00000000" />
            </label>
            ${isRegistration ? "" : `
              <label class="account-form__field" for="pending-auth-password">
                <span>NEW PASSWORD</span>
                <input id="pending-auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="AT LEAST 8 CHARACTERS" />
              </label>
              <label class="account-form__field" for="pending-auth-confirm-password">
                <span>REPEAT NEW PASSWORD</span>
                <input id="pending-auth-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="REPEAT PASSWORD" />
              </label>`}
          </div>
          <button class="account-form__submit" type="submit">${isRegistration ? "CONFIRM ACCOUNT" : "SAVE NEW PASSWORD"}</button>
        </form>
        <p class="account-feedback" id="pending-auth-feedback" role="status">${escapeXml(accountFeedback)}</p>
        <button class="account-secondary-button" data-account-view="${isRegistration ? "register" : "forgot"}" type="button">START AGAIN</button>
      </section>`,
    "account-screen browser-auth-screen",
  );

  document.querySelector<HTMLFormElement>("#pending-auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const codeInput = form.elements.namedItem("code") as HTMLInputElement;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement | null;
    const confirmPasswordInput = form.elements.namedItem("confirmPassword") as HTMLInputElement | null;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>("#pending-auth-feedback");
    if (!button || !feedback || !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (passwordInput && confirmPasswordInput && passwordInput.value !== confirmPasswordInput.value) {
      feedback.textContent = "The two passwords do not match.";
      confirmPasswordInput.select();
      return;
    }

    button.disabled = true;
    button.textContent = "VERIFYING";
    feedback.textContent = "";
    try {
      const code = codeInput.value.replace(/\s/g, "");
      const user = isRegistration
        ? await verifyRegistrationCode(pending.email, code)
        : await verifyPasswordRecoveryCode(pending.email, code);
      if (!isRegistration && passwordInput) await updateAccountPassword(passwordInput.value);
      await connectAccountUser(user);
      clearPendingAuth();
      accountView = "sign-in";
      accountFeedback = isRegistration
        ? "Email confirmed. Your archive is ready."
        : "Password changed. Your archive is open.";
      renderAccount();
    } catch (error) {
      console.error(error);
      accountFeedback = "The code is invalid or has expired. Request a new code and try again.";
      feedback.textContent = accountFeedback;
      button.disabled = false;
      button.textContent = isRegistration ? "CONFIRM ACCOUNT" : "SAVE NEW PASSWORD";
      codeInput.select();
    }
  });
  bindAccountViewButtons();
}

function renderRegistration(): void {
  shell(
    `
      <section class="account-copy">
        <p class="eyebrow"><span>ACCOUNT</span><span>REGISTRATION</span></p>
        <h1>CREATE<br />THE ARCHIVE</h1>
        <p class="account-intro">Choose an email and password. A one-time code will confirm the address before the archive opens.</p>
        <form class="account-form" id="registration-form">
          <div class="account-form__fields">
            <label class="account-form__field" for="registration-email"><span>EMAIL</span><input id="registration-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="YOU@EXAMPLE.COM" /></label>
            <label class="account-form__field" for="registration-password"><span>PASSWORD</span><input id="registration-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="AT LEAST 8 CHARACTERS" /></label>
            <label class="account-form__field" for="registration-confirm-password"><span>REPEAT PASSWORD</span><input id="registration-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="REPEAT PASSWORD" /></label>
          </div>
          <button class="account-form__submit" type="submit">CREATE ACCOUNT</button>
        </form>
        <p class="account-feedback" id="registration-feedback" role="status">${escapeXml(accountFeedback)}</p>
        <button class="account-secondary-button" data-account-view="sign-in" type="button">I ALREADY HAVE AN ACCOUNT</button>
      </section>`,
    "account-screen",
  );

  document.querySelector<HTMLFormElement>("#registration-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
    const confirmPasswordInput = form.elements.namedItem("confirmPassword") as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>("#registration-feedback");
    if (!button || !feedback || !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (passwordInput.value !== confirmPasswordInput.value) {
      feedback.textContent = "The two passwords do not match.";
      confirmPasswordInput.select();
      return;
    }

    button.disabled = true;
    button.textContent = "CREATING ACCOUNT";
    feedback.textContent = "";
    try {
      const email = emailInput.value.trim();
      const result = await registerWithPassword(email, passwordInput.value);
      if (result.signedIn && result.user) {
        await connectAccountUser(result.user);
        accountFeedback = "Account created. Your archive is ready.";
        renderAccount();
        return;
      }
      rememberPendingAuth({ email, purpose: "registration" });
      accountFeedback = `Confirmation code sent to ${email}.`;
      renderPendingAuth({ email, purpose: "registration" });
    } catch (error) {
      console.error(error);
      accountFeedback = "The account could not be created. Check the address and password, or sign in if the account already exists.";
      feedback.textContent = accountFeedback;
      button.disabled = false;
      button.textContent = "CREATE ACCOUNT";
    }
  });
  bindAccountViewButtons();
}

function renderForgotPassword(): void {
  shell(
    `
      <section class="account-copy">
        <p class="eyebrow"><span>ACCOUNT</span><span>RECOVERY</span></p>
        <h1>RECOVER<br />THE ARCHIVE</h1>
        <p class="account-intro">Enter the account email. We will send one code that lets you choose a new password.</p>
        <form class="account-form" id="recovery-request-form">
          <div class="account-form__fields account-form__fields--single">
            <label class="account-form__field" for="recovery-email"><span>EMAIL</span><input id="recovery-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="YOU@EXAMPLE.COM" /></label>
          </div>
          <button class="account-form__submit" type="submit">SEND RECOVERY CODE</button>
        </form>
        <p class="account-feedback" id="recovery-request-feedback" role="status">${escapeXml(accountFeedback)}</p>
        <button class="account-secondary-button" data-account-view="sign-in" type="button">BACK TO SIGN IN</button>
      </section>`,
    "account-screen",
  );

  document.querySelector<HTMLFormElement>("#recovery-request-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>("#recovery-request-feedback");
    if (!button || !feedback || !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    button.disabled = true;
    button.textContent = "SENDING CODE";
    feedback.textContent = "";
    try {
      const email = emailInput.value.trim();
      await sendPasswordRecoveryCode(email);
      rememberPendingAuth({ email, purpose: "recovery" });
      accountFeedback = `Recovery code sent to ${email}.`;
      renderPendingAuth({ email, purpose: "recovery" });
    } catch (error) {
      console.error(error);
      accountFeedback = "The recovery code could not be sent. Check the address and try again.";
      feedback.textContent = accountFeedback;
      button.disabled = false;
      button.textContent = "SEND RECOVERY CODE";
    }
  });
  bindAccountViewButtons();
}

function renderChangePassword(): void {
  shell(
    `
      <section class="account-copy">
        <p class="eyebrow"><span>ACCOUNT</span><span>SECURITY</span></p>
        <h1>CHANGE<br />THE PASSWORD</h1>
        <p class="account-intro">Choose a new password for ${escapeXml(accountUser?.email ?? "this account")}.</p>
        <form class="account-form" id="change-password-form">
          <div class="account-form__fields">
            <label class="account-form__field" for="change-password"><span>NEW PASSWORD</span><input id="change-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="AT LEAST 8 CHARACTERS" /></label>
            <label class="account-form__field" for="change-confirm-password"><span>REPEAT NEW PASSWORD</span><input id="change-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="REPEAT PASSWORD" /></label>
          </div>
          <button class="account-form__submit" type="submit">SAVE NEW PASSWORD</button>
        </form>
        <p class="account-feedback" id="change-password-feedback" role="status">${escapeXml(accountFeedback)}</p>
        <button class="account-secondary-button" data-account-view="sign-in" type="button">BACK TO ACCOUNT</button>
      </section>`,
    "account-screen",
  );

  document.querySelector<HTMLFormElement>("#change-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
    const confirmPasswordInput = form.elements.namedItem("confirmPassword") as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const feedback = document.querySelector<HTMLElement>("#change-password-feedback");
    if (!button || !feedback || !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (passwordInput.value !== confirmPasswordInput.value) {
      feedback.textContent = "The two passwords do not match.";
      confirmPasswordInput.select();
      return;
    }
    button.disabled = true;
    button.textContent = "SAVING PASSWORD";
    try {
      await updateAccountPassword(passwordInput.value);
      accountView = "sign-in";
      accountFeedback = "Password updated.";
      renderAccount();
    } catch (error) {
      console.error(error);
      feedback.textContent = "The password could not be changed. Please sign in again and retry.";
      button.disabled = false;
      button.textContent = "SAVE NEW PASSWORD";
    }
  });
  bindAccountViewButtons();
}

function renderAccount(): void {
  if (!accountServiceConfigured) {
    shell(
      `
        <section class="account-copy">
          <p class="eyebrow"><span>ACCOUNT</span><span>UNAVAILABLE</span></p>
          <h1>ARCHIVE<br />OFFLINE</h1>
          <p class="account-intro">The private account service is not connected. Your cards remain safe in this browser.</p>
        </section>`,
      "account-screen",
    );
    return;
  }

  if (!accountConnectionSecure) {
    shell(
      `
        <section class="account-copy">
          <p class="eyebrow"><span>ACCOUNT</span><span>SECURE CONNECTION REQUIRED</span></p>
          <h1>DO NOT ENTER<br />A PASSWORD</h1>
          <p class="account-intro">The domain does not have a valid HTTPS certificate yet. Account access will unlock automatically after HTTPS is repaired.</p>
        </section>`,
      "account-screen",
    );
    return;
  }

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

  const pending = readPendingAuth();
  if (!accountUser && pending) {
    renderPendingAuth(pending);
    return;
  }

  if (accountUser) {
    if (accountView === "change-password") {
      renderChangePassword();
      return;
    }

    const email = escapeXml(accountUser.email ?? "PRIVATE ACCOUNT");
    shell(
      `
        <section class="account-copy account-copy--connected">
          <p class="eyebrow"><span>ACCOUNT</span><span>${accountArchiveConnected ? "ARCHIVE SYNCED" : "SYNC PENDING"}</span></p>
          <h1>YOUR PATH<br />IS SAVED</h1>
          <p class="account-intro">Your cards and journey can follow you to another device. This account stores no public profile.</p>
          <dl class="account-details">
            <div><dt>SIGN-IN EMAIL</dt><dd>${email}</dd></div>
            <div><dt>OBSERVATIONS</dt><dd>${state.history.length}</dd></div>
            <div><dt>UNIQUE CARDS</dt><dd>${Object.keys(state.cardsSeen).length}</dd></div>
            <div><dt>STORAGE</dt><dd>PRIVATE</dd></div>
          </dl>
          ${accountFeedback ? `<p class="account-feedback" role="status">${escapeXml(accountFeedback)}</p>` : ""}
          <div class="account-auth-links account-auth-links--connected">
            <button type="button" data-account-view="change-password">SET / CHANGE PASSWORD</button>
            <button id="account-sign-out" type="button">SIGN OUT ON THIS DEVICE</button>
          </div>
        </section>`,
      "account-screen",
    );

    document.querySelector<HTMLButtonElement>("#account-sign-out")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "SIGNING OUT";
      try {
        await signOutAccount();
        accountUser = null;
        accountArchiveConnected = false;
        accountView = "sign-in";
        accountFeedback = "Cloud archive disconnected. The current browser copy remains available.";
        renderAccount();
      } catch (error) {
        console.error(error);
        accountFeedback = "Could not sign out. Please try again.";
        renderAccount();
      }
    }, { once: true });
    bindAccountViewButtons();
    return;
  }

  if (accountView === "register") {
    renderRegistration();
    return;
  }
  if (accountView === "forgot") {
    renderForgotPassword();
    return;
  }

  shell(
    `
      <section class="account-copy">
        <p class="eyebrow"><span>ACCOUNT</span><span>PASSWORD</span></p>
        <h1>OPEN<br />THE ARCHIVE</h1>
        <p class="account-intro">Sign in with your email and password. A code is needed only when creating an account or recovering a forgotten password.</p>
        ${signInFormMarkup("account", accountFeedback)}
        <p class="account-privacy">Your browser observations will join the private archive after sign-in.</p>
      </section>`,
    "account-screen",
  );

  bindSignInForm("account");
}

function renderDrawRoute(): void {
  if (browserDraws[currentDateKey()]) renderLocked();
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
  if (!accountServiceConfigured || !accountConnectionSecure) {
    accountReady = true;
    return;
  }
  try {
    accountUser = await initializeAccountSession();
    if (accountUser) {
      await connectAccountUser(accountUser);
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

    if (event === "PASSWORD_RECOVERY" && session?.user) {
      accountView = "change-password";
      clearPendingAuth();
      void connectAccountUser(session.user)
        .then(() => {
          renderAccount();
        })
        .catch((error) => {
          console.error(error);
          accountArchiveConnected = false;
          accountFeedback = "Choose a new password, then archive synchronization will retry.";
          renderAccount();
        });
      return;
    }

    if (event === "SIGNED_IN" && session?.user && session.user.id !== accountUser?.id) {
      void connectAccountUser(session.user)
        .then(() => {
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
