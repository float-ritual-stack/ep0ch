// A call's handle (PIE-685): `leaping_otter_convergence` for the call `c-7f3a1c`, so a person can say and recognise which
// MCP caller's visit wrote something. A call is the BBS word for it: an MCP connection is a caller into the board.
//
// The handle is minted once and stored (the MCP server's registry, door/src/mcp-calls.ts, id to handle under a unique
// index); the id stays the key and the handle is what people type and see. The hash of the id only seeds the pick, so a
// registry that lost a handle would mint the same one again; a clash takes `_2`, `_3` inside the write that checks
// the index. An id the agent chose itself (`daddy-2026-10-09-0103-k7f`) is its own handle.
//
// The lists are the project's world: the BBS and demoscene, techno, outlines and gardens, weather, the float vocabulary.
// They hold no persona or product word (nothing that reads as attribution next to `by`), and no word from a chat's
// content: a handle is picked from these lists and nothing else. Edit them freely; a handle already minted is stored and
// does not change. 200 x 200 x 200 is eight million handles.
// Pure: no I/O.

const words = (s: string) => s.trim().split(/\s+/);

/** The first word: how it moves (adjectives and participles). */
export const NAME_FIRST = words(`
leaping drifting glowing humming rolling spinning slow quiet bright amber velvet static looping rising falling
folding branching rooted blooming wild patient nimble gentle steady restless midnight dawn salted smoky mossy
dusty frosted sunlit hollow ragged tidy tangled braided sparse lush brisk calm curious daring eager fierce
giddy hushed idle jolly keen lazy lucid merry nested nocturnal open polite proud quick radiant sleepy sly
soft sturdy swift tender thrifty tiny upbeat vivid warm wistful witty zesty analog digital modular hybrid
buffered cached cycling dialing echoing fading flickering gliding grooving harmonic kinetic layered linked
melodic mirrored muted orbiting panning phased pulsing resonant sampled scrolling shifting sliding syncing
tuned wandering winding woven wobbling yawning zooming arcing basking cresting dappled drizzling eddying
fluttering foggy gusting hailing misty monsoon sweeping thawing windy balmy breezy cloudy crisp dewy drowsy
gilded glassy golden hazy icy jade leafy lilac lunar marine mellow neon opal pearly plum rosy russet sable
sage silver slate solar teal tawny twilight umber violet willowy woody ashen azure bronze copper coral ivory
ochre onyx pewter saffron scarlet sepia indigo
blinking bouncing buzzing chiming clicking crackling dancing dreaming fizzing flowing glimmering howling
jangling lilting murmuring rustling shimmering simmering sparkling stirring swaying tumbling whistling
`);

/** The second word: who (the cast of a board: callers, keepers, creatures and plants). */
export const NAME_SECOND = words(`
otter marlin wombat ferret civet serval tapir bonobo kakapo quokka dormouse sprite pixel ansi modem carrier baud
handshake caller operator guest doorman keeper ranger tinker weaver gardener tender potter mason cartographer
navigator pilot sailor courier scribe bard cantor drummer synth sampler tracker coder cracker scener phreak
hacker wizard druid hermit nomad pilgrim wren heron finch sparrow lark owl fox badger hare moth beetle
cricket firefly spider snail tortoise salamander lynx raven crane magpie swift swallow plover kestrel osprey
marten stoat vole mole newt toad frog carp trout pike eel gull tern puffin seal whale orca dolphin octopus
jelly urchin anemone fern moss lichen clover thistle nettle sorrel yarrow tansy basil thyme fennel
rosemary mint dill chive borage marigold poppy aster dahlia peony iris lupin foxglove hollyhock sunflower
bean squash pumpkin leek kale chard beet radish turnip parsnip carrot onion garlic pea fig quince medlar
plum pear apple cherry walnut hazel chestnut birch alder willow rowan aspen elder oak ash elm maple cedar
pine larch yew juniper bramble hawthorn blackthorn
bittern curlew dunlin egret grebe jay kingfisher linnet nuthatch pipit redstart siskin starling stonechat
teal wagtail warbler waxwing weasel wolf yak ibex marmot pika lemur gecko
`);

/** The third word: what (places, outlines, music, weather, the float vocabulary). */
export const NAME_THIRD = words(`
convergence outline branch bullet block tile screen board thread note page link anchor backlink embed figure
callout fence ledger index digest archive margin gutter spine cursor prompt buffer cache socket relay forward
tunnel bridge gateway mirror queue pull push merge rebase patch proposal revision receipt journal changelog
roadmap workboard briefing signal noise static carrier tone chord scale octave rhythm groove loop break drop
build bassline arpeggio sequence pattern sample filter sweep delay reverb echo feedback resonance harmonic
overtone subharmonic downbeat offbeat swing shuffle crescendo cadence refrain coda interlude overture
weather front pressure squall gale breeze drizzle shower thunder lightning rainbow aurora eclipse equinox
solstice tide current eddy delta estuary fjord glacier meadow orchard hedgerow greenhouse allotment trellis
compost seedbed furrow harvest garden grove thicket clearing canopy understory ridge valley summit plateau
harbour lighthouse beacon lantern campfire workshop shack cathedral bazaar lobby corridor atrium vestibule
engine ritual drift pulse spiral lattice mosaic ember horizon threshold interval orbit transit epoch
rainfall snowfield hailstorm heatwave cloudbank moonrise sunrise sunset nightfall daybreak crossroads waystation
watchtower boathouse pottingshed windmill millpond footbridge towpath jetty quayside dockyard signalbox
switchboard patchbay mixdown masterclass soundcheck encore intermission matinee cassette vinyl floppy
diskette tapedeck jukebox arcade pinball cabinet joystick keyboard terminal teletype
`);

/** Words that read as attribution or product names, kept out of the lists (a test holds the lists to it). */
export const FORBIDDEN_WORDS = ["claude", "daddy", "loki", "cowboy", "kitty", "evna", "karen", "shypht", "sysop", "herdr", "pie", "anthropic", "codex", "gpt", "gemini", "copilot"] as const;

/** FNV-1a, 32 bits: small, stable and good enough to seed a pick. */
function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The handle an id seeds, before any clash: one word from each list. An id an agent chose is its own handle. */
export function seedHandle(id: string): string {
  if (!/^c-[0-9a-f]{6}$/.test(id)) return id;
  const pick = (list: readonly string[], seed: number) => list[fnv(id, seed) % list.length]!;
  return `${pick(NAME_FIRST, 0x811c9dc5)}_${pick(NAME_SECOND, 0x9e3779b1)}_${pick(NAME_THIRD, 0x85ebca6b)}`;
}

/**
 * The handle to store for `id`: its seed, or the seed with `_2`, `_3` … when `taken` says a handle is already another
 * call's. The caller runs this and the insert in one transaction under a unique index.
 */
export function freeHandle(id: string, taken: (handle: string) => boolean): string {
  const seed = seedHandle(id);
  if (!taken(seed)) return seed;
  for (let n = 2; ; n++) if (!taken(`${seed}_${n}`)) return `${seed}_${n}`;
}
