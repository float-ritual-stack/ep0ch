// The showcase seed's media (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SocketBoard } from "../../socket";
import { SEED } from "./names";

/**
 * The callouts section's note (PIE-538): Obsidian's own examples (https://obsidian.md/help/callouts) in every form the
 * reader draws — nested three deep, folded and open with - and +, title-only, custom titles, several paragraphs — and
 * a type this outline declares (`recipe`, from the note after it).
 */
export const CALLOUTS = [
  SEED.callouts,
  "",
  "Obsidian's examples. ( ) then f, or a click on a title, folds one; ⏎ or a click on its icon or type changes its type; z opens them all; e, then > [! offers the types.",
  "",
  "> [!note] note",
  "> body",
  "> > [!warning] warning",
  "> > body body",
  "",
  "> [!note]- collapse",
  "> can you see me",
  "",
  "> [!note]+ expando",
  "> feel the power",
  "",
  "> [!question] Can callouts be nested?",
  "> > [!todo] Yes!, they can.",
  "> > > [!example]  You can even use multiple layers of nesting.",
  "",
  "> [!faq]- Are callouts foldable?",
  "> Yes! In a foldable callout, the contents are hidden when the callout is collapsed.",
  "",
  "> [!tip] Title-only callout",
  "",
  "> [!tip] Callouts can have custom titles",
  "> Like this one.",
  "",
  "> [!info]",
  "> Here's a callout block.",
  "> It supports **Markdown** and [[Bike shed|links]].",
  ">",
  "> - and lists",
  "> - inside it",
  ">",
  "> A second paragraph, after a blank quoted line.",
  "",
  "> [!dish] Soup stock",
  "> Bones, an onion, two bay leaves; `dish` is an alias of this outline's own recipe type.",
].join("\n");

/** The showcase's own pictures (fictional, drawn for it): a JPEG, a WebP and a bright PNG, so decoding and dimming are shown on every platform. */
export const SHOWCASE_ASSETS = join(import.meta.dir, "..", "assets");

/**
 * The images section's note (PIE-532): a header image, and images sized, placed and given alt text by the properties
 * on their lines; the reader's keys, its caption controls and image.* change them.
 */
export const imagesText = (dir = SHOWCASE_ASSETS) => [
  SEED.images,
  `- [img::${dir}/allotment-dusk.jpg] [layout::hero] [alt::the plot at dusk]`,
  "",
  "The picture above the title is this note's header, the hero layout on its line: the reader draws it the full width, at most a third of its height, cropped to fill. [ ] to an image, then + and - size it, ← → move it, H makes it the header, or click the controls at the end of its caption. ctrl+z puts a change back.",
  "",
  `[img::${dir}/seed-packet.webp] [size::25%] [align::center] [alt::a packet of beetroot seed]`,
  "",
  "A quarter of the reader's width, centred. The one below is half, on the right:",
  "",
  `[img::${dir}/allotment-dusk.jpg] [size::50%] [align::right]`,
  "",
  `- [img::${dir}/seed-packet.webp] [height::6]`,
  "  - six rows tall, its width from its shape",
  "",
  "The notice board is paper white: it's dimmed as it's drawn, as every bright image is, so no image is brighter than the door. [dim::0.5] on its line would set how much.",
  "",
  `[img::${dir}/allotment-notice.png] [size::50%] [alt::the notice board, dimmed]`,
].join("\n");

/**
 * The gallery section's note (PIE-827): the outliner's gallery extension draws its child notes as cards with their
 * `[cover::]` pictures, and `pic::` one picture, each through the `image` primitive. Nothing is written for them.
 */
export const galleryText = (dir = SHOWCASE_ASSETS) => [
  SEED.gallery,
  "",
  "The cards below are the gallery extension's view: each child note is a card with its [cover::] picture, drawn as a note's image is. The picture under them is pic::.",
  "",
  "gallery::",
  "",
  `pic:: ${dir}/evening-beds.jpg`,
].join("\n");

/** The gallery's cards: made-up notes, each naming its cover picture. */
export const galleryCards = (dir = SHOWCASE_ASSETS) => [
  `Beetroot, Boltardy [cover::${dir}/seed-packet.webp]\nSow March to July, thin to a hand apart.`,
  `The plot at dusk [cover::${dir}/allotment-dusk.jpg]\nFrom the gate, after the watering.`,
  `Notice board [cover::${dir}/allotment-notice.png]\nPaper white: dimmed as it's drawn.`,
];

/** The artifacts section's files (PIE-793): fictional, made for it, a React one (Tone and Tailwind) and an HTML one (three r128). */
export const SHOWCASE_ARTIFACTS = ["pulse-pad.jsx", "orbit-lamp.html"] as const;

export async function placeArtifacts(board: SocketBoard): Promise<string> {
  await board.request("artifacts.put", { name: "showcase-orbit", files: { "index.html": readFileSync(join(SHOWCASE_ASSETS, "artifacts", "orbit-lamp.html"), "utf8") } });
  const frozen = await board.request<{ version: number }>("artifacts.snapshot", { name: "showcase-orbit" });
  return `showcase-orbit@${frozen.version}`;
}

export const artifactsText = (pinned = "showcase-orbit@1") => [
  SEED.artifacts,
  "",
  "A live folder and a frozen snapshot, stored outside the outline. Drop a file or built folder in the synced inbox. Once settled, it becomes the next version and disappears from the inbox; receipts.log records its URL and .failed keeps rejected drops with a reason. Reload the live frame; the snapshot stays as it was. Enter or click [open ↗] to open the same static URL the web note frames.",
  "",
  "[artifact::showcase-orbit] [height::22] [alt::Orbit lamp]",
  "",
  "The snapshot is pinned by number:",
  "",
  `artifact:: ${pinned} [alt::Orbit lamp pinned]`,
].join("\n");

/**
 * The hero section's note (PIE-598): its first block is a picture, so as it scrolls up under the reader's header the
 * header takes it as a dimmed backdrop, centred on the lit shed (`[hero-focus::…]`). Long enough to scroll.
 */
export const heroText = (dir = SHOWCASE_ASSETS) => [
  `${SEED.hero} [season::autumn]`,
  `[img::${dir}/evening-beds.jpg] [layout::hero] [hero-focus::0.85,0.6] [blur::4] [bleed::full] [height::33%] [fit::cover] [dim::0.4] [tint::0.5] [fade::0.75] [title::over] [scroll::pinned] [alt::the beds at dusk, the shed lit]`,
  "",
  "Tune header.image.* at any level, or write blur, bleed, height, fit, dim, tint, fade, title and scroll on the hero line. This header is blurred, full bleed, a third high, cover cropped, dimmed, tinted, faded, titled over and pinned. The line wins over tune defaults. In cells, scroll down (j, the wheel, space): as the picture goes up under the header, the title, the byline and the crumbs take it as their background, dimmed and muted so they stay readable. It fades in from the background by steps.",
  "",
  "The crop follows the lit shed: `[hero-focus::0.85,0.6]` on the picture's line moves it (across, then down). An image marked `[layout::hero]` does the same once it scrolls away above the title.",
  "",
  "`reader.hero on=false` (an agent's `act`, or `ep0ch act reader.hero on=false`) turns it off in every reader, kept for the next start; on=true brings it back. `mode=follow` makes the header follow each picture as it scrolls under; `mode=first` keeps it on this one.",
  "",
  "With `reader.hero on=true mode=follow` the header follows the pictures: this one takes over as it scrolls under, fading in over the first.",
  "",
  `[img::${dir}/allotment-dusk.jpg] [size::60%] [alt::the plot at dusk, from the gate]`,
  "",
  "## The beds this week",
  "",
  ...Array.from({ length: 14 }, (_, i) => `- Bed ${i + 1}: ${["garlic, in by the first frost", "broad beans for spring", "leeks, earthed up", "green manure", "kale and chard", "the rhubarb crowns, mulched", "onion sets"][i % 7]}`),
  "",
  "## Jobs before the clocks go back",
  "",
  ...["Lift the last of the potatoes and dry them on the bench", "Clean and oil the hoe, the rake and the shears", "Empty the water butts below the tap line", "Cover the compost bays with the old carpet", "Net the brassicas against the pigeons", "Stack the canes in the shed, tallest at the back", "Sow sweet peas in root trainers on the windowsill", "Mend the gate latch (it drops in the wind)", "Order the seed potatoes before the catalogue runs out", "Leave the seed heads standing for the finches"].map(j => `- ${j}`),
  "",
  "## Notes",
  "",
  "The frost pocket by the lower fence gets it first: nothing tender goes in there before May. The pond needs its leaves skimmed weekly until December.",
  "",
  "The neighbour on plot 14 swaps her leek seedlings for our spare broad beans; we owe her a dozen in March.",
  "",
  "",
  "## The year on the plot",
  "",
  ...["January: plan the beds, order seed", "February: chit the potatoes", "March: broad beans and onions in", "April: first earlies, carrots under fleece", "May: beans up the canes after the last frost", "June: weed, water, net the fruit", "July: pick, pick, pick", "August: sow the winter salads", "September: lift the maincrop", "October: garlic in, green manure down", "November: mulch the rhubarb", "December: mend the tools, read the catalogues"].map(m => `- ${m}`),
  "",
  "The light goes early now. The shed's lamp is on a timer; the watering can by the door is still full from the morning.",
].join("\n");

/** A callout type this outline declares (PIE-538): the reader, the completer and the type choice all offer it. */
export const CALLOUT_TYPE = [
  `${SEED.calloutType} [callout-type::recipe] [callout-icon::♨] [callout-tone::green] [callout-aliases::dish]`,
  "",
  "Declares a callout type: `> [!recipe]` (or `> [!dish]`) draws with this icon and tone, and offers it wherever types are offered.",
].join("\n");
