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

The first visit and daily card remain anonymous. After the first reveal, the visitor is invited to save the path with a six-digit code sent by email. `MY DECK`, archived card records and `MY JOURNEY` are private account views; the current daily card can still be reopened without signing in. Email is kept in Supabase Auth, and the application does not request a name, username, phone number, birthday or public profile. The existing local collection is attached on the first sign-in, and an existing remote archive wins when the account is opened on another device.

GitHub Pages hosts the static frontend. Supabase provides the hosted PostgreSQL database, authentication API and email-code verification, so the current account flow does not require a separate VPS.

### 1. Create the database

1. Create a hosted project at [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor → New query**.
3. Paste and run all of [`supabase/schema.sql`](supabase/schema.sql).
4. Confirm that `oracle_profiles` and `oracle_archives` appear in **Table Editor** and that RLS is enabled.

### 2. Make the authentication email contain a code

1. Open **Authentication → Providers → Email** and keep email sign-in and new-user signup enabled.
2. Open **Authentication → Email Templates → Magic Link**. Supabase uses this template for both magic links and email OTP.
3. Replace the link with the OTP variable. A minimal template is:

```html
<h2>Your Own Houdini</h2>
<p>Your private archive access code:</p>
<p style="font-size:32px;letter-spacing:8px"><strong>{{ .Token }}</strong></p>
<p>This code expires shortly. Ignore this email if you did not request it.</p>
```

The template must contain `{{ .Token }}` rather than `{{ .ConfirmationURL }}` or Supabase will send a link instead of a six-digit code. OTP expiry and resend limits are configured under the Email provider and Auth rate-limit settings. See the official [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [email template](https://supabase.com/docs/guides/auth/auth-email-templates) documentation.

### 3. Configure email delivery

Supabase's built-in sender is suitable only for initial testing and is heavily rate-limited. For a public release, configure **Project Settings → Authentication → SMTP Settings** with a verified sender from an SMTP provider. Supabase supports any provider that supplies an SMTP host, port, username and password. Verify the sender domain and disable link tracking because this project uses an OTP code. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

### 4. Connect local development

Copy [`.env.example`](.env.example) to `.env.local`, then use the **Project URL** and **Publishable key** (or legacy public `anon` key) from the Supabase project's API settings:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

Restart `npm run dev` after changing `.env.local`. When both values exist, the site automatically stops showing the temporary on-page code and sends the real code by email.

### 5. Connect GitHub Pages

Store the same two public build values as GitHub Actions secrets. The commands prompt for each value without placing it in shell history:

```bash
gh secret set VITE_SUPABASE_URL --repo Godcomplexx/eink.oracle
gh secret set VITE_SUPABASE_ANON_KEY --repo Godcomplexx/eink.oracle
gh workflow run deploy.yml --repo Godcomplexx/eink.oracle
```

Check deployment with:

```bash
gh run watch --repo Godcomplexx/eink.oracle
```

The public publishable/anonymous key is expected to be present in a browser build; access to account rows is restricted by Postgres Row Level Security. Never put a Supabase secret key or legacy `service_role` key in Vite, `.env.local` committed to Git, or GitHub Pages.

### Final server-side draw

Account authentication and archive synchronization work with the setup above. For a tamper-resistant final release, card selection and the one-draw-per-day check must additionally move from the browser to a Supabase Edge Function. That function should perform the weighted graph draw and write `oracle_draws`, observations, edges and events atomically. The browser must never receive its service-role credential.

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
