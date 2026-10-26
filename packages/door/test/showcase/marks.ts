// What each showcase section's own part draws, once it has read the outline (the screen tests wait for these).

// What each section's own part draws, once it has read the outline.
export const marks: Record<string, string[]> = {
  note: ["Allotment notebook", "the same NoteSurface, as the BBS reader · src/screens.ts", "Subj: Allotment notebook", "↗"],
  // The detail screen spec on the notebook: the detail tile's own frame and keys around the same surface.
  detail: ["Allotment notebook", "Our plot at the Elm Row allotments.", "p follow", "↑↓ j k blocks"],
  // A long note to scroll past the end of (PIE-622), a short one beside it.
  scroll: ["The long row of runner beans", "End (or G) goes to the last line", "Bike shed"],
  // The list scrolls: the note set's header and the registry are on screen; the desk set is further down.
  actions: ["NOTE_ACTIONS · src/surface/note.ts", "the action registry · src/surface/actions.ts"],
  edit: ["Kitchen whiteboard", "properties · 9"],
  // The finding note: what / (the power bar's notes scope) finds, typos and all.
  search: ["Finding things in the house notes", "Press / (on the river, g) and type"],
  // The meeting on the left, a comment being written on the guide on the right (PIE-762).
  "deep-links": ["Greenhouse meeting, October", "We agreed to water the seedlings", "» comment"],
  completion: ["Ask about the beds, see ((Gree", "block"],
  // A comment ending in [[seed: the pages and an extension's issues in one list (PIE-1340).
  sources: ["Which issue is the swap, see [[seed", "issue"],
  // Four readers on one note, each writing a comment in another place (PIE-770).
  composer: ["Writing in the margin", "[inline ▸]", "[floating ▸]", "[split ▸]", "[popup ▸]"],
  // A comment on the whole note in its own tile beside the reader (PIE-846); the note's whole-note thread in the margin.
  "comment-tile": ["Seed library opening hours", "comment on the whole note", "The winter shelf needs a lock", "comment · reader"],
  // The draft session: an edit open on the left, a comment being written on the right.
  drafts: ["editing · Kitchen whiteboard", "» comment", "[add them]"],
  // Three kept edits against notes that moved on: one with a new line, one the note already has (settled), one old (a chip).
  kept: ["Greenhouse watering rota", "from your edit yesterday", "[add them]", "was already in the note", "1 old edit"],
  // The guide two agents raced on: @fern's words in it, @moss's proposal drawn after its last line with its controls.
  proposals: ["Seed sowing guide", "beans in late May", "proposed edit from @moss", "[resolve]", "[dismiss]"],
  // An edit with a whole document pasted in by mistake, one step, and the page token selected with its [copy].
  undo: ["editing · Jar labels", "pasted 42 lines · ctrl+z undoes", "[copy]"],
  hints: ["source: select wire", "select wire", "HintCard"],
  panes: ["outline", "children", "Visitors", "Kitchen sink"],
  "book-spines": ["Bike shed", "Allotment notebook", "spines"],
  folds: ["outline", "children", "◂", "▾"],
  screens: ["Daily brief", "2026-03-11", "Needs you"],
  kinds: ["tile kinds", "tree ^W o t", "backlinks ^W o l"],
  // EchoNet's message areas on the mini network: the band's rail, both areas, the nodelist's down node and the one that dials in.
  echonet: ["MESSAGE AREAS", "PLOT.CHAT", "SEED.SWAP", "society@box-a", ",DOWN", ",DIAL", "last tosses"],
  terminal: ["a terminal tile: sh in a pty the door owns", "shell"],
  lift: ["Allotment notebook", "Our plot at the Elm Row allotments."],
  addresses: ["Allotment notebook", "first", "second", "third"],
  drawer: ["the kettle: a terminal tile to put in your drawer", "kettle"],
  // A fake deploy reporting its status (OSC 7501) beside the waiting-on-you list that follows it.
  status: ["a fake deploy, saying what it does with OSC 7501", "waiting on you"],
  // Two made-up agent sessions (PIE-737): moss docked here, fern pinned to the drawer, the panel listing both.
  access: ["who can reach what", "garden-bot", "● full"],
  sessions: ["moss, a demo agent (made up for the showcase)", "demo-agent · moss", "demo-agent · fern"],
  changes: ["what changed", "garden-agent edited the three log notes"],
  // Three readers at the three levels of what an agent may do to a tile: the chips on the edit and hands-off tiles.
  agents: ["say what an agent may do to each tile", "* agents: edit only", "! agents: hands off"],
  preview: ["outline"],
  "reader-modes": ["outline", "stays put", "▣"],
  screen: ["board ·", "· lanes", "HOME-003", "True the front wheel"],
  spine: ["Queued", "Doing", "Review", "Done", "HOME-003"],
  entity: ["Bike shed", "The pump's spare valves are on the kitchen whiteboard.", "↓ children (2)", "Puncture kit", "← backlinks (", "resources (1)"],
  "cross-outline": ["showcase-orchard", "Orchard journal", "Water the pear tree"],
  "select-open": ["tree, preview, detail from scratch", "select wires show the picked row"],
  "links-open": ["Bike shed", "links · Bike shed", "preview"],
  // The compost heap in a detail, the two notes under it listed in its links tile: what d d trashes.
  trash: ["Compost heap", "links · Compost heap", "Turning log"],
  // The outline, the shed held in a detail with its own ::links, a preview of the detail's selection.
  // The saved view open in the tree: its matches marked, the count in the tag, the results line.
  "tree-views": ["Garden chores", "V:", "matches · children to depth", "reader"],
  "lists-open": ["Bike shed", "detail", "preview · detail", "[ LINKS ]"],
  // The frost note in a detail, its #tags drawn as links.
  tags: ["Before the first frost", "#frost-jobs", "#compost"],
  // The swap thread, its links with every group, and the same tile with Children alone (its replies).
  children: ["Seed swap thread", "children · Seed swap", "↓ children (4)", "Ana: runner beans to swap"],
  // The leek thread, opened on a reply three deep: the panel's tree with the note marked and a level folded around it.
  thread: ["Who has spare leek seedlings?", "THREAD", "► Ben: mine are still in modules", "2 more earlier", "1 more later"],
  "links-rows": ["One line", "Two lines", "Truncate", "Carry the trestle tables"],
  // The day's plan with its outbox: the waiting letters listed, the first one previewed beside the list.
  "links-block": ["Plan for Saturday", "OUTBOX", "Ask Ana about the bean seed", "3 matches", "⏎ in"],
  "list-view": ["One list, three ways", "OUTBOX", "Waiting letters", "Shelf actions", "Copy this note"],
  "agent-focus": ["Plan for Saturday", "@fern:3", "@moss:5", "who's online"],
  presence: ["who's online", "last callers · live"],
  "inline-lists": ["Parcels on the desk", "Parcel 01", "After the list:"],
  live: ["GARDEN CHORES (LIVE QUERY)", "live · 3 results", "HOUSE JOBS BY ARC (LIVE)"],
  // The society page: one question as a list, tabs by crop and a rank by season.
  questions: ["Allotment society", "NOT LINKED BACK", "20 matches", "BY CROP", "beans 3 · brassicas 3"],
  // One key written in every form, each listed with its line, one ::if body drawn; two project pages with one figure.
  "fields-if": ["Where a key is written", "EVERY CONNECTTO IN THIS NOTE", "in the header", "is a row each", "HASHTAGS (KEY TAG)", "greenhouse", "this paragraph is drawn only while the note is active"],
  templates: ["Sowing meeting", "Filed on Sowing meeting", "Filed on Potting meeting", "Prune the roses", "Pot up the tomatoes", "needs with"],
  "page-figure": ["Lego night", "Garden club", "TICKETS FOR THIS PROJECT", "Sort the bricks", "Water the beans"],
  // The plot calendar's dates, written four ways, asked as any property (PIE-769); the lanes are saved views.
  dates: ["Plot calendar", "DUE IN THREE DAYS", "DONE WAITING", "IN ITS WINDOW TODAY", "Due in th"],
  tabs: ["PLOT JOBS", "doing 2 · review 1 · validate 0 · done 1 · queued 2", "≡ cozy"],
  // The build log: its two open calls under Needs you, the decided ones drawn as their marks.
  steps: ["Shed roof build log", "Needs you", "felt from the merchant", "screws, not nails"],
  values: ["Vent rail demo", "Owner: Ada", "did you mean owner?", "Spring sowing jobs"],
  "figure-steps": ["Shed door test plan", "YOU TEST", "lift the latch twice", "Plane the door"],
  "resource-comments": ["bed-plan.md", "Net the brassicas before the pigeons find them.", "shown (M)"],
  // The plan with its highlight and its answered question in the margin, the leaflet beside it, the notebook.
  marginalia: ["Greenhouse plan for the spring", "question · ", "cold-frame-guide.md", "Marginalia notebook"],
  // The pump rota's margin: its current comment and the kept one's TL;DR face; the seen one is off the margin.
  "margin-attention": ["Pump rota", "TL;DR Sewing", "Could we swap"],
  // The plan's answered question beside Recent replies, which lists the answer.
  "margin-replies": ["Greenhouse plan for the spring", "question · ", "Recent replies"],
  // Three generated regions in prose (PIE-956): a script's table, a ::= sentence, a written output region, each behind a mark.
  "output-regions": ["Regions in prose", "Sam sows beans"],
  projection: ["Jira ACME-12 · Rollout checklist for the vendor switch", "Jira ACME-14 · Label printer drops the last line", "Jira · ambiguous: ACME-20, ACME-21", "Jira ACME-30 · not registered", "can't fetch: item was not found"],
  // Without the outliner's examples installed (this scratch seeds with the tickets only), the lines are properties.
  extensions: ["Omens for the allotment week", "extensions"],
  // The gallery extension's cards with their covers, and pic::'s one picture (PIE-827); no Kitty graphics here, so captions.
  gallery: ["Seed packet gallery", "Beetroot, Boltardy", "▣ seed-packet.webp", "▣ evening-beds.jpg · no Kitty graphics in this terminal"],
  // Machinery (PIE-867): one query asked twice, the people's view and the tools'.
  machinery: ["Written by people", "Written by tools"],
  // Line chips (PIE-1277): the header-only view and the one that reads every line, which says the line.
  "line-asks": ["Club asks, header only", "Club asks, any line", "line 12 to do"],
  runbook: ["Try a terminal runbook", "[run]"],
  // The Extensions hub beside the notifications hub's page: its README, and its demo boards under it.
  "ext-pages": ["Extensions", "## Installed", "Notifications hub", "A deterministic fetcher"],
  // Two notes, each writing its own form: the reading log and the shed repairs, side by side.
  forms: ["Reading log", "Shed repairs"],
  // The outliner's example rules, installed by the seed: meeting-card's card, shout's band, the job done-stamp watches.
  rules: ["Allotment committee, Saturday", "[meeting]", "CLOSE THE COLD FRAME TONIGHT", "Mend the water butt"],
  // A rule note beside a view: both configurable, , opens either's card.
  settings: ["Compost bay jobs get a badge", "A rule note is configured, not typed", "Plot chat"],
  selection: ["Lentil soup", "Drag across these lines"],
  service: ["views.read ((Garden chores))", "ready · 3 block(s)", "references.backlinks (Bike shed)"],
  // This door runs in its own terminal (the test's App), so the section says so; in a session it lists the terminals.
  session: ["this door runs in its own terminal (--no-daemon)", "session"],
  // Obsidian's examples, nested three deep; the right reader declares a type of the outline's own.
  callouts: ["Callouts, as Obsidian writes them", "Can callouts be nested?", "Yes!, they can.", "Recipe callouts"],
  // This test's terminal has no Kitty graphics: each image's line says what it is, with its controls.
  "list-folds": ["Five garden decisions", "Keep the beans", "Save seeds from the strongest plants."],
  images: ["Pictures of the plot", "▀ header allotment-dusk.jpg", "▣ seed-packet.webp · no Kitty graphics in this terminal", "[−][+] [◂][▸] [▀]", "▣ allotment-notice.png"],
  // A note whose first block is a picture: scrolled, the header takes it as its background (PIE-598).
  hero: ["An evening on the plot", "▀ header evening-beds.jpg", "hero-focus"],
  // Two artifacts as cards (PIE-793): the React one titled by its line, the HTML one by its own <title>.
  artifacts: ["Toys on the desk", "◇ artifact", "[open ↗]", "Orbit lamp", "Orbit lamp pinned"],
  // The reader's header (PIE-657): the title in it, the dim line, the old header written out to compare.
  title: ["A title you can find", "Before:", "3 note detail · A title you can find"],
  // The Markdown figures on the left (a decision first), the keys read from the registry on the right.
  figures: ["Figures, written in Markdown", "SQUASH BEDS", "Raised beds", "The reader's keys", "[e]"],
  focus: ["Figures, written in Markdown", "SQUASH BEDS", "The reader's keys"],
  // A guide note with a [[page]] nobody wrote yet, for ctrl+n, the offer and the page title fill.
  "move-note": ["Moving notes", "Cold frame"],
  // The guide and the recipe it routes (PIE-1010), the key named on the guide.
  routing: ["Notes that file themselves", "Pickled walnuts", "alt+z"],
  newnotes: ["New notes from anywhere", "Seed swap ledger", "ctrl+n"],
  // A reader and a terminal whose program asked for the mouse, each with its ⋯.
  menu: ["Allotment notebook", "this program asked for the mouse", "\u2261"],
  wkeys: ["Allotment notebook", "Bike shed"],
  "line-field": ["Allotment notebook", "Bike shed"],
  // A blank screen: its rows, each a first step.
  made: ["A blank screen. Start it with a tile here:", "t  the outline", "o  open a screen…"],
  // Two readers to zoom one of, a link to light and a menu to open: the Esc rule's three nested things.
  esc: ["Allotment notebook", "Bike shed"],
  // The shed note folded to a spine (the keys on it) beside the notebook: a key the spine refuses says why on its frame.
  refusals: ["Allotment notebook", "Bike shed"],
  // One note in two readers: the wide one bands its headings, the narrow one draws them as written.
  headings: ["Headings and dividers", "▾ ## Beds", "Water butts"],
  // The Spacing lab page in its look, the tune inspector beside it, the links tile, the Looks lab note that declares it.
  style: ["Spacing lab", "tune · lab", "list.gap", "Looks lab"],
  "style-one-list": ["Style one list of several", "First oats", "Middle beans", "Last sage", "tune · lists"],
  // The component library on the heading styles' page: its tabs, its parts, the minimal example.
  library: ["Heading styles", "1 overview", "Minimal example"],
  // The outline beside a reader over two details, the second folded to a spine: the tiles the power bar lists as a tree.
  bar: ["outline", "Kitchen whiteboard", "Bike shed"],
  // A reader and a shell for a hyper chord to reach the door from, and the part's line.
  hyper: ["Allotment notebook", "a terminal tile: with the layer on", "reach the door"],
  // The tags tile beside a reader: every tag with its uses, sorted, and picked to narrow.
  "facets": ["#frost-jobs", "uses▾", "facets"],
  "rich-edit": ["Seed inventory", "Beans", "Packets"],
  asks: ["Keep writing while the answer arrives"],
  neat: ["A neat workbench", "[neat]"],
  wyrm: ["Wyrmhold", "join the realm", "Dozing Gerald"],
  scripts: ["Seed report", "Press alt+S"],
  "button-sequences": ["One button, two tiles", "Fold the bottom", "Sugar"],
  "pick-a-tile": ["Pick a tile instead of typing its id", "pop it", "misread"],
  "scripts-in-place": ["Scripts in place", "beds-table"],
  press: ["Noughts and crosses", "ttt-board"],
  "status-bar": ["Your buttons on the status bar", "[Collapse]"],
  "message-log": ["Message log", "garden gate needs attention"],
  motion: ["Tiles that move", "Shuffle the tiles"],
  fantasia: ["Fantasia", "✦ Fantasia"],
  "script-examples": ["Game 1", "Seed order"],
  "one-place": ["The long row of runner beans", "Bike shed"],
  "reading-line": ["The long row of runner beans", "Allotment notebook"],
  replies: ["Replies at the orchard", "Orchard row 1"],
  snapshot: ["A SQLite copy for analysis", "outline.snapshot"],
  upload: ["Hand a file to ep0ch", "artifact.lease"],
  "front-matter": ["Early sowing notes", "A plan for the seed bed"],
  "nested-mounts": ["calls", "last callers"],
  insert: ["Insert files beside a draft", "Ctrl+T", "Television shows its marks"],
};
