# Your Own Houdini

**No prophecy. Just a card you probably needed today.**

A small e-ink oracle device and companion website. Press the physical button once a day to reveal a card and a short message.

## Website prototype

The first browser-only vertical slice is implemented with Vite and TypeScript. It currently includes:

- a responsive reveal experience;
- one draw per local calendar day using `localStorage`;
- a weighted journey graph, cooldowns, unlock conditions and hidden pity;
- ten prototype card definitions;
- a JSON card catalogue with build-time validation;
- five rarity materials powered by `cards-css`;
- pointer interaction, optional device tilt and reduced-motion support;
- the original `THE MIRROR` artwork, with code-generated placeholders for unfinished cards.

Run it locally:

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

The one-card-per-local-calendar-day limit is enforced in both local development and production builds.

## GitHub Pages

Pushes to `main` automatically build and deploy the site through GitHub Actions.
The repository Pages source must be set to **GitHub Actions** under
**Settings → Pages → Build and deployment**. The published URL is:

```text
https://godcomplexx.github.io/eink.oracle/
```

Development phases and release criteria are tracked in [SITE_IMPLEMENTATION_PLAN.md](SITE_IMPLEMENTATION_PLAN.md).

Card text and meanings live in [`content/cards`](content/cards/README.md). Optimized Vite artwork lives in `src/assets/cards/<imageKey>/card.webp`; adding a card does not require editing the TypeScript catalogue.

## Concept

- Custom original card deck
- Progressive weighted card graph instead of pure random
- Cooldowns to avoid obvious repeats
- Rare cards, anomalies and hidden lore
- Daily TikTok format: `DAY 001 → click → card → message`
- Website lets visitors reveal their own daily card without an account
- Houdini theme references his history of exposing fraudulent spiritualists

## Prototype

- Seeed XIAO ESP32-S3 Plus
- WeAct 3.7" 240×416 black/white e-paper
- Li-Po battery
- Draw button
- Power switch
- Custom enclosure

## Credits and third-party code

The website's interactive holographic card materials use and adapt [`cards-css`](https://github.com/kongyo2/cards-css) by **kongyo2**, distributed under the MIT License. Its copyright and license notice are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The visual direction was also inspired by [`Pokémon Cards CSS Holographic Effect`](https://github.com/simeydotme/pokemon-cards-css) by **Simon Goellner / simeydotme**. That project is licensed under GPL-3.0; its source code and Pokémon assets are not included in this project.

> The card means nothing until you see yourself in it.
