# Your Own Houdini

**No prophecy. Just a card you probably needed today.**

Your Own Houdini is an experimental digital oracle built around an original illustrated card deck. It does not claim to predict the future. Each card offers an image, a short message and enough ambiguity for the observer to discover their own meaning.

The project exists as a web experience and as a concept for a small e-ink object with a single physical draw button.

## The experience

A visitor can reveal a card immediately, without creating an account. The first observation begins a personal journey through the deck.

An optional passwordless account saves the archive through a private access code sent by email. The archive contains:

- **My Deck** — discovered cards and collection progress;
- **History** — every recorded observation;
- **My Journey** — a living graph of cards, transitions, returns and discoveries.

Each browser can contribute one observation per day. When the same account is opened in different browsers, their cards are preserved as separate observations and joined into one expanding journey graph.

## The card system

Cards are selected through a progressive weighted graph rather than simple random choice. Previous observations influence which paths become available next.

The system includes:

- thematic states and transitions;
- cooldowns that reduce obvious repetition;
- unlock conditions and hidden branches;
- Common, Rare, Arcane, Anomaly and Houdini cards;
- cards that return to earlier states, reveal forgotten consequences or temporarily bypass a missing prerequisite.

The algorithm knows the history of the archive, but it does not interpret the person. Meaning appears only in the observer's reaction to the image.

## Houdini

The Houdini theme refers to Harry Houdini's history of exposing fraudulent spiritualists. Its rarest cards focus on evidence left after an impossible escape: open restraints, empty devices and explanations that never arrive.

## The physical object

The companion object is imagined as a quiet, single-purpose e-ink oracle:

- Seeed XIAO ESP32-S3 Plus;
- 3.7-inch black-and-white e-paper display;
- one draw button;
- rechargeable battery;
- custom enclosure.

The limited display and deliberate interaction are part of the idea: one small image, one message and no endless feed.

## Website

[einkoracle.org](https://einkoracle.org/)

## Credits

The interactive card materials use and adapt [`cards-css`](https://github.com/kongyo2/cards-css) by **kongyo2**, distributed under the MIT License. Its copyright and license notice are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The visual direction was also inspired by [`Pokémon Cards CSS Holographic Effect`](https://github.com/simeydotme/pokemon-cards-css) by **Simon Goellner / simeydotme**. That project is licensed under GPL-3.0; its source code and Pokémon assets are not included here.

> The card means nothing until you see yourself in it.
