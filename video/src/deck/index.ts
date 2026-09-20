/**
 * Standalone Remotion entry for the deck, so it can be previewed and stilled without
 * touching video/src/Root.tsx (the main video owns that file).
 *
 *   npx remotion studio src/deck/index.ts
 *   npx remotion still  src/deck/index.ts Slide-board out/deck/board.png
 *   npx remotion render src/deck/index.ts Deck out/deck.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { Deck, SLIDES, deckTotalFrames } from "./Deck";

const Root = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Composition, { id: "Deck", component: Deck, durationInFrames: deckTotalFrames, fps: 30, width: 1920, height: 1080 }),
    ...SLIDES.map((s) =>
      React.createElement(Composition, { key: s.id, id: `Slide-${s.id}`, component: s.Component, durationInFrames: s.durationInFrames, fps: 30, width: 1920, height: 1080 }),
    ),
  );

registerRoot(Root);
