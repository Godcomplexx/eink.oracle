# Your Own Houdini

**No prophecy. Just a card you probably needed today.**

A small e-ink oracle device and companion website. Press the physical button once a day to reveal a card and a short message.

## Website prototype

The first browser-only vertical slice is implemented with Vite and TypeScript. It currently includes:

- a responsive reveal experience;
- one draw per local calendar day using `localStorage`;
- a weighted journey graph, cooldowns, unlock conditions and hidden pity;
- passwordless accounts that synchronize the existing local archive;
- a versioned JSON catalogue with 35 card definitions and build-time validation;
- five rarity materials powered by `cards-css`;
- pointer interaction, optional device tilt and reduced-motion support;
- production artwork for 28 cards, with code-generated placeholders kept only for unfinished drafts.

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

## Private account storage

The first visit and daily card remain anonymous. After the first reveal, the visitor is invited to save the path through a passwordless email link. `MY DECK`, archived card records and `MY JOURNEY` are private account views; the current daily card can still be reopened without signing in. Email is kept in Supabase Auth, and the application does not request a name, username, phone number, birthday or public profile. The existing local collection is attached on the first sign-in, and an existing remote archive wins when the account is opened on another device.

To enable accounts:

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
2. Set the production Site URL to `https://godcomplexx.github.io/eink.oracle/` and allow that exact redirect URL. Add `http://localhost:5173/eink.oracle/` and `http://127.0.0.1:5173/eink.oracle/` while developing locally.
3. Copy [`.env.example`](.env.example) to `.env.local` and provide the project URL and public anonymous key.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub repository Actions secrets before deploying Pages.

The public anonymous key is safe to expose in the built browser application; access to account rows is restricted by Postgres Row Level Security. Never use a Supabase service-role key in Vite or GitHub Pages.

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
