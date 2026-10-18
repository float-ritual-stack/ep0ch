// Shared composer and toolbar on published pages and in the bookmarklet.
export const READER_COMPOSE_STYLE = `
.mg-ui{--fg:#ddd;--dim:#aaa;--rule:#444;color:var(--fg)}
.mg-ui[hidden]{display:none!important}
.mg-ui{font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
.mg-ui button{font:15px/1 ui-sans-serif,system-ui,sans-serif;min-height:44px;min-width:44px;padding:0 .9rem;border-radius:.5rem;border:1px solid var(--rule);background:#222220;color:var(--fg);cursor:pointer;flex:none}
.mg-ui button:active{background:#2c2c2a}
.mg-ui button.quiet{background:none;color:var(--dim)}
#mg-bar{position:fixed;left:0;right:0;bottom:0;z-index:10;display:flex;gap:.4rem;overflow-x:auto;padding:.5rem .75rem calc(.5rem + env(safe-area-inset-bottom));background:#1a1a19;border-top:1px solid var(--rule)}
#mg-sheet{position:fixed;left:0;right:0;bottom:0;z-index:11;background:#1a1a19;border-top:1px solid var(--rule);padding:.75rem .75rem calc(.75rem + env(safe-area-inset-bottom))}
#mg-sheet .q{color:var(--dim);font-style:italic;max-height:4.5em;overflow:hidden;margin:0 0 .5rem}
#mg-sheet .why{color:#e0b46a;margin:.4rem 0 0}
textarea.mg-in{box-sizing:border-box;width:100%;min-height:5.5rem;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;background:#111110;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.5rem}
.mg-row{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:.5rem}
#mg-toast{position:fixed;left:1rem;right:1rem;bottom:5.5rem;z-index:12;max-width:30rem;margin:0 auto;background:#222220;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.55rem .9rem}
`;
