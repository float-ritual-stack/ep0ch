//! Probe 5, the half the compiler answers: which rune-kit builders can be given a tile's state by id.
//!
//! A kit builder that takes a closure can capture a tile id and find that tile's state in a
//! `HashMap<TileId, TileUi>`. One that takes a plain `fn(&mut S) -> &mut T` cannot: a function pointer captures
//! nothing, so it can only name a field of `S` that exists when the app is compiled. Each `compile_fail` block below
//! is the same call as the block beside it that compiles, with one captured id added.
//!
//! ## Closures: a tile id fits
//!
//! Text fields (`TextInput`, `TextArea`, `TextField`), buttons, and a `TabStrip`'s select, close and reorder
//! handlers.
//!
//! ```
//! use std::collections::HashMap;
//! use rune::{TextEdit, Tx};
//! use rune_kit::{Kit, TextInput, shell::{TabItem, TabOrientation, TabStrip}};
//! struct Desk { fields: HashMap<String, TextEdit>, active: HashMap<String, String> }
//! fn build(s: &Desk, k: &Kit, tile: String) {
//!     let id = tile.clone();
//!     TextInput::new(&s.fields[&tile]).on_edit(move |s: &mut Desk| s.fields.get_mut(&id).unwrap()).build(k);
//!     let id = tile.clone();
//!     TabStrip::new(format!("tabs/{tile}"), TabOrientation::Horizontal)
//!         .tabs([TabItem::new("links", "Links")])
//!         .on_select(move |s: &mut Desk, tab: &str, _: &mut Tx| { s.active.insert(id.clone(), tab.to_owned()); })
//!         .build(k);
//! }
//! ```
//!
//! ## Function pointers: only a field named at compile time
//!
//! `SplitView`'s panes: a fixed field compiles.
//!
//! ```
//! use rune_kit::{Kit, shell::{PaneState, SplitView}};
//! struct Desk { side: PaneState }
//! fn build(s: &Desk, k: &Kit) {
//!     SplitView::new(rune::el()).sidebar(&s.side, |s: &mut Desk| &mut s.side, rune::el()).build(k);
//! }
//! ```
//!
//! A pane found by tile id does not (`expected fn pointer, found closure`).
//!
//! ```compile_fail,E0308
//! use std::collections::HashMap;
//! use rune_kit::{Kit, shell::{PaneState, SplitView}};
//! struct Desk { panes: HashMap<String, PaneState> }
//! fn build(s: &Desk, k: &Kit, tile: String) {
//!     let id = tile.clone();
//!     SplitView::new(rune::el()).sidebar(&s.panes[&tile], move |s: &mut Desk| s.panes.get_mut(&id).unwrap(), rune::el()).build(k);
//! }
//! ```
//!
//! The kit `Tree`: a fixed model compiles.
//!
//! ```
//! use rune_kit::{Kit, Tree, TreeModel};
//! struct Desk { beds: TreeModel<String> }
//! fn build(s: &Desk, k: &Kit) {
//!     Tree::new(|s: &Desk| &s.beds, |s: &mut Desk| &mut s.beds, |label: &String| label.as_str()).build(s, k);
//! }
//! ```
//!
//! A model per tile does not.
//!
//! ```compile_fail,E0308
//! use std::collections::HashMap;
//! use rune_kit::{Kit, Tree, TreeModel};
//! struct Desk { trees: HashMap<String, TreeModel<String>> }
//! fn build(s: &Desk, k: &Kit, tile: String) {
//!     let (a, b) = (tile.clone(), tile.clone());
//!     Tree::new(move |s: &Desk| &s.trees[&a], move |s: &mut Desk| s.trees.get_mut(&b).unwrap(), |label: &String| label.as_str()).build(s, k);
//! }
//! ```
//!
//! A `TabStrip`'s drag state: one shared by the window compiles (and `tests/tiles.rs` shows two strips sharing it).
//!
//! ```
//! use rune_kit::{Kit, shell::{TabDragState, TabOrientation, TabStrip}};
//! struct Desk { tab_drag: TabDragState }
//! fn build(s: &Desk, k: &Kit) {
//!     TabStrip::<Desk>::new("tabs/a", TabOrientation::Horizontal).drag_state(&s.tab_drag, |s: &mut Desk| &mut s.tab_drag).build(k);
//! }
//! ```
//!
//! One per tabs container does not.
//!
//! ```compile_fail,E0308
//! use std::collections::HashMap;
//! use rune_kit::{Kit, shell::{TabDragState, TabOrientation, TabStrip}};
//! struct Desk { drags: HashMap<String, TabDragState> }
//! fn build(s: &Desk, k: &Kit, tabs: String) {
//!     let id = tabs.clone();
//!     TabStrip::<Desk>::new("tabs/a", TabOrientation::Horizontal).drag_state(&s.drags[&tabs], move |s: &mut Desk| s.drags.get_mut(&id).unwrap()).build(k);
//! }
//! ```
