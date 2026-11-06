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
 * The pictures section's note (PIE-1555): a ```mermaid flowchart, sequence and state diagram, a ```svg fence and an
 * [img::…svg] line, each drawn as a picture under kitty graphics and as its source (with what it is) without.
 */
export const picturesText = (dir = SHOWCASE_ASSETS) => [
  `${SEED.pictures} [season::autumn] [beds::three] [banner::yes]`,
  "plot-banner:: [layout::hero]",
  "",
  "The header above is a render script's SVG (Plot banner, under this note), its line carrying [layout::hero]: the note's title and properties laid out, its two links pressed like any link ([ ] to them, ⏎ or a click). Change [season::] and it's drawn again. The board below draws the same banner on each card:",
  "",
  "The same banner again on a line of its own: one header, and this picture beside it, each sized apart (image.size by=1 writes this line's height).",
  "",
  "plot-banner:: [height::4]",
  "",
  "plot-cards::",
  "",
  "Each fence below is drawn as its picture, the reader's width; ~ shows the note as written, the fences' text again. Without kitty graphics they stay text, their first row saying what they draw.",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Sow] --> B{Frost tonight?}",
  "  B -->|yes| C[Cover the bed]",
  "  B -->|no| D[Water]",
  "  C --> E[Harvest]",
  "  D --> E",
  "```",
  "",
  "Who fetches what from the shed:",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  participant Gardener",
  "  Gardener->>Shed: the fork, please",
  "  Shed-->>Gardener: the fork",
  "  Gardener->>Neighbour: netting?",
  "  Neighbour-->>Gardener: a spare roll",
  "```",
  "",
  "```mermaid",
  "stateDiagram-v2",
  "  [*] --> Seed",
  "  Seed --> Sprout: water",
  "  Sprout --> Plant: a month",
  "  Plant --> Seed: saved",
  "  Plant --> [*]",
  "```",
  "",
  "An svg fence, sized by its fence's height= word: its caption's [−] [+], + and - with it selected, or image.size through act all write that word. Two fences that read alike are two pictures: each resizes on its own, and past an insert above them, and [+] stops where the next step would draw the same.",
  "",
  "```svg height=6",
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90" viewBox="0 0 360 90"><rect width="360" height="90" rx="8" fill="#101826"/><g fill="#4fb3c7"><circle cx="45" cy="45" r="18"/><circle cx="135" cy="45" r="18"/><circle cx="225" cy="45" r="18"/><circle cx="315" cy="45" r="18"/></g><text x="180" y="84" fill="#9aa7b8" font-family="DejaVu Sans, sans-serif" font-size="12" text-anchor="middle">four beans to a row</text></svg>`,
  "```",
  "",
  "And an SVG file, as any image is:",
  "",
  `[img::${dir}/plot-plan.svg] [size::full] [alt::the plot plan]`,
].join("\n");

/**
 * The pictures section's scripts (PIE-1555): a module that draws a note's banner as SVG from its title and properties,
 * with two links laid out in it; a render script that returns it as an image primitive's `svg` (the note's header, its
 * line carrying [layout::hero]); and one that draws the same banner on each card of a board. Made up.
 */
export const PLOT_ART = [
  "Plot art [script::plot-art] [mode::module]",
  "```js",
  "const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');",
  "const tones = { spring: '#4f9c6b', summer: '#c9a23f', autumn: '#b8683a', winter: '#5f7fb8' };",
  "/** A note's banner: its title and season laid out, leaves in its season's colour, two links to press. */",
  "function banner(note) {",
  "  const get = key => (note.properties.find(p => p.key === key)?.values ?? []).join(', ');",
  "  const season = get('season') || 'spring', beds = get('beds') || 'some', tone = tones[season] ?? '#5f7fb8';",
  "  const leaves = Array.from({ length: 9 }, (_, i) => `<circle cx='${40 + i * 70}' cy='${30 + (i % 3) * 14}' r='${8 + (i % 4) * 3}' fill='${tone}' opacity='0.5'/>`).join('');",
  "  const font = \"font-family='DejaVu Sans, sans-serif'\";",
  "  const chip = (x, href, words) => `<a href='${href}'><rect x='${x}' y='132' width='150' height='30' rx='6' fill='#1b2a3d'/><text x='${x + 14}' y='152' fill='#4fb3c7' ${font} font-size='15'>${words}</text></a>`;",
  "  return `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='180' viewBox='0 0 640 180'><rect width='640' height='180' rx='10' fill='#0d121b'/>${leaves}`",
  "    + `<text x='32' y='92' fill='#c8d0dc' ${font} font-size='34'>${esc(note.title)}</text><text x='32' y='118' fill='${tone}' ${font} font-size='16'>${esc(season)} · ${esc(beds)} beds</text>`",
  "    + chip(32, '[[Bike shed]]', 'the bike shed ›') + chip(200, '[[Allotment notebook]]', 'the notebook ›') + `</svg>`;",
  "}",
  "return { banner };",
  "```",
].join("\n");

export const PLOT_BANNER = [
  "Plot banner [script::plot-banner] [mode::render]",
  "```js",
  "import { banner } from 'plot-art';",
  "return view.image({ alt: `banner: ${this.title}`, svg: banner(this) });",
  "```",
].join("\n");

export const PLOT_CARDS = [
  "Plot cards [script::plot-cards] [mode::render]",
  "```js",
  "import { banner } from 'plot-art';",
  "const rows = (await q('banner=yes', { limit: 6 })).blocks;",
  "const notes = await Promise.all(rows.map(r => read(r.id)));",
  "return view.row({ children: notes.map(n => view.card({ title: n.title, link: n.id, children: [view.image({ svg: banner(n), alt: n.title, caption: false })] })) });",
  "```",
].join("\n");

/** The notes the board's cards draw (made up): each drawn with the same banner as the note's header. */
export const PLOT_CARD_NOTES = [
  "Bean row [banner::yes] [season::summer] [beds::two]\nRunners up the canes, dwarfs along the front.",
  "Winter cover [banner::yes] [season::winter] [beds::one]\nCardboard and leaf mould until March.",
];

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
  "",
  `pic:: ${dir}/evening-beds.jpg`,
  "",
  "## Covers from the shelf",
  "",
  "A ::view in gallery or feed draws each note's [layout::hero] picture as its card's cover, cropped to the card; a feed row holds it as a thumbnail. cover= names a property to read first, and body=0 keeps the card to its title and summary.",
  "",
  '::view{query="shelf=seed-cards" layout="gallery, feed" summary-properties="title, bed" sort="title asc" body=0} ^covers',
  "::",
].join("\n");

/** The shelf a `::view` draws in the gallery section (PIE-1595): each note's header picture is its card's cover. */
export const shelfCards = (dir = SHOWCASE_ASSETS) => [
  `Beetroot on the bench [shelf::seed-cards] [bed::north]\n\n[img::${dir}/allotment-notice.png] [layout::hero] [alt::the notice by the bench]\n\n- Sow March to July.\n- Thin to a hand apart.`,
  `The plot at dusk, from the gate [shelf::seed-cards] [bed::south]\n\n[img::${dir}/allotment-dusk.jpg] [layout::hero] [hero-focus::0.5,0.7] [alt::the plot at dusk]\n\n- After the watering.\n- Thin to a hand apart.`,
  `The beds, evening [shelf::seed-cards] [bed::east]\n\n[img::${dir}/evening-beds.jpg] [layout::hero] [alt::the beds in the evening]\n\n- The shed lit.\n- Thin to a hand apart.`,
];

/** The gallery's cards: made-up notes, each naming its cover picture. */
export const galleryCards = (dir = SHOWCASE_ASSETS) => [
  `Beetroot, Boltardy [cover::${dir}/seed-packet.webp]\nSow March to July, thin to a hand apart.`,
  `The plot at dusk [cover::${dir}/allotment-dusk.jpg]\nFrom the gate, after the watering.`,
  `Notice board [cover::${dir}/allotment-notice.png]\nPaper white: dimmed as it's drawn.`,
  `Plot plan [cover::${dir}/plot-plan.svg]\nAn SVG file: a card's cover as any picture is.`,
];

/** The artifacts section's files (PIE-793): fictional, made for it, a React one (Tone and Tailwind) and an HTML one (three r128). */
export const SHOWCASE_ARTIFACTS = ["pulse-pad.jsx", "orbit-lamp.html"] as const;

export async function placeArtifacts(board: SocketBoard): Promise<string> {
  // The showcase contacts no deployment account: its outline goes without the deploy rule, so its repo lines never clone.
  const [rule] = (await board.request("blocks.query", { query: { where: "rule-name=deploy-artifact" } })).blocks;
  if (rule) await board.trash(rule.id);
  await board.request("artifacts.put", { name: "showcase-orbit", files: { "index.html": readFileSync(join(SHOWCASE_ASSETS, "artifacts", "orbit-lamp.html"), "utf8") } });
  const frozen = await board.request("artifacts.snapshot", { name: "showcase-orbit" });
  return `showcase-orbit@${frozen.version}`;
}

export const artifactsText = (pinned = "showcase-orbit@1") => [
  SEED.artifacts,
  "",
  "A live folder and a frozen snapshot, stored outside the outline. Drop a file or built folder in the synced inbox. Once settled, it becomes the next version and disappears from the inbox; receipts.log records its URL and .failed keeps rejected drops with a reason. Reload the live frame; the snapshot stays as it was. Enter or click [open ↗] to open the same static URL the web note frames.",
  "",
  "[artifact::showcase-orbit] [height::22] [alt::Orbit lamp]",
  "",
  "## Deployment catalogue",
  "",
  "Orbit lamp [repo::example/orbit-lamp] [where::float-2] [commit::demo] [deployed-at::2026-01-01]",
  "",
  "This is a fictional deployment row over the scratch store's live artifact above. A real repo deployment adds its URL and commit to the catalogue and the requesting note. Static files use the store; a build script, app framework or server uses Vercel. No deployment account is contacted by this showcase.",
  "",
  "The snapshot is pinned by number:",
  "",
  `artifact:: ${pinned} [alt::Orbit lamp pinned]`,
  "",
  "Or name a file the host can read. Absolute paths, paths relative to the outline folder and ~/ paths enter the same store. The next read snapshots changed content; a deleted file keeps its last snapshot, with a warning on the card. The note keeps the path you wrote.",
  "",
  `[artifact::${join(SHOWCASE_ASSETS, "artifacts", "orbit-lamp.html")}] [alt::Orbit lamp from a file]`,
  "",
  "## A repo",
  "",
  "Name a GitHub repo on a line and the card follows its deployment: deploying, live at its address (Enter or [open ↗] opens the site), or why not with the command that fixes it, and what its last run did. In your outline, saving the note runs the deploy rule and the run's note is filed under the artifacts page. This showcase's outline has no deploy rule and no deployments, so the first card says how to deploy it and the second, outside ep0ch-artifacts, how to fork it there.",
  "",
  "[artifact::https://github.com/ep0ch-artifacts/orbit-lamp-site]",
  "",
  "[artifact::github.com/example-studio/orbit-lamp-site]",
].join("\n");

/**
 * The hero section's note (PIE-598): its first block is a picture, so as it scrolls up under the reader's header the
 * header takes it as a dimmed backdrop, centred on the lit shed (`[hero-focus::…]`). Long enough to scroll.
 */
export const heroText = (dir = SHOWCASE_ASSETS) => [
  `${SEED.hero} [season::autumn]`,
  `[img::${dir}/evening-beds.jpg] [layout::hero] [hero-focus::0.85,0.6] [blur::4] [bleed::full] [height::33%] [fit::cover] [dim::0.4] [tint::0.5] [fade::0.75] [title::over] [scroll::pinned] [alt::the beds at dusk, the shed lit]`,
  "",
  "This header's look is its own line: blur, bleed, height, fit, dim, tint, fade, title and scroll written there, so the note carries it into any tile. It is blurred, full bleed, a third high, cover cropped, dimmed, tinted, faded, titled over and pinned. alt+y opens the tune: its Hero rows change this line at once. Drag the header's bottom row to size it, the picture above it to move its focus. In cells, scroll down (j, the wheel, space): as the picture goes up under the header, the title, the byline and the crumbs take it as their background, dimmed and muted so they stay readable. It fades in from the background by steps.",
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

/** The same command-copy journey used by the real terminal regression. */
export const SPAN_COPY = [
      "Span copy garden [page::Span copy garden]", "Paragraph `paragraph-copy`.", "- List `bullet-copy`.", "- [ ] Task `step-copy`.", "",
      "> [!todo] Garden setup", "> Paragraph `callout-copy`.", "> - List `callout-list-copy`.", "> - [ ] Task `callout-task-copy`.", "> - [ ] Run `garden link setup --host garden.example --name shed --label brass watering can --finish callout-tail`",
      "> > [!note] Nested", "> > > [!tip] Deep", "> > > - [ ] Task `nested-copy`.", "",
      "| Place | Command |", "| --- | --- |", "| Shed | `table-copy` |", "",
      "- [ ] Run `garden link setup --host garden.example --name shed --label brass watering can --finish wrapped-tail`", "",
      "::graph-check", "- [ ] Run `figure-copy`", "::",
    ].join("\n");
