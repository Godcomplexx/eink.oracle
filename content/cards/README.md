# Card content

Each card is stored as one JSON file named after its `id`:

```text
content/cards/the-mirror.json
```

Production artwork is optional during development. When it exists, place it under the same `imageKey`:

```text
src/assets/cards/the-mirror/card.webp
```

Supported production formats are `avif`, `webp`, `png`, `jpg`, and `jpeg`. Prefer an optimized `webp` or `avif` file. Keep source-quality originals outside `src/assets` because everything in that directory is included in the web build.

The minimum content fields are:

- `id` — unique slug matching the JSON filename;
- `title` — displayed card name;
- `message` — short daily message;
- `meaning` — longer canonical meaning for future collection views;
- `rarity`, `theme`, `state`, and `element`;
- `tags`, `nextNodes`, and `unlockConditions`;
- `graphEffect` and `cooldown`;
- `symbol` and accessible `imageAlt`;
- `imageKey` — asset folder name, or `null` for the generated placeholder.
- `mechanic` — internal human-readable summary of the selection and graph rule;
- `showcase` — marks an official reference card for one of the five card types;
- `visibility` — `PUBLIC` or `HIDDEN_UNTIL_DISCOVERED` for secret archive cards.
- `status` — optional, `"draft"` or `"live"` (default `"live"` when omitted). A
  `draft` card is still validated but is excluded from the runtime `CARDS` pool
  in `src/cards.ts`, so it never enters the daily draw. Use it while authoring a
  new card in place: write and validate the JSON (and its art), leave it as
  `draft`, then flip it to `live` (or remove the field) once it's ready to ship.
  A `draft` card cannot also be a type `showcase` card.

The five card types and their official showcase cards are defined once in
`content/card-types.json`. `HOUDINI` uses a hidden discovery count, so the UI must
never expose a total such as `1 / 7`.

Validate the catalogue:

```bash
npm run content:validate
```

Validation also runs automatically before every production build. It checks required fields, IDs, graph values, card references, and image files.
