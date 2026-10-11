// Vendored from https://github.com/e-schultz/ptyZZZ static/ptyzzz-client.js at bf0f730d6445cb11e4f75d40f4b8fe3912e6d75f (MIT, Andy Gayton). Unchanged below.
// Browser adapter for ptyZZZ's semantic mouse protocol. The terminal reports
// whether the application has grabbed the mouse on its rendered cursor element;
// this adapter otherwise leaves native selection and scrollback alone.

function grabbed(pane) {
  return pane?.querySelector(".cursor")?.dataset.mouseGrabbed === "true";
}

function mods(ev) {
  return (ev.shiftKey ? 1 : 0) |
    (ev.altKey ? 2 : 0) |
    (ev.ctrlKey ? 4 : 0) |
    (ev.metaKey ? 8 : 0);
}

function locate(pane, ev) {
  const grid = pane?.querySelector('.scroll > [id^="grid-"]');
  if (!grid) return null;
  const rows = [...grid.querySelectorAll(":scope > .row")];
  const visible = Math.min(Number(grid.dataset.rows) || 0, rows.length);
  const live = rows.slice(rows.length - visible);
  if (!live.length) return null;

  let y = live.indexOf(ev.target.closest?.(".row"));
  if (y < 0) {
    y = live.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return ev.clientY >= rect.top && ev.clientY < rect.bottom;
    });
  }
  if (y < 0) return null;

  const rect = live[y].getBoundingClientRect();
  const cols = Number(grid.dataset.cols) || 1;
  if (!rect.width || !rect.height || ev.clientX < rect.left || ev.clientX >= rect.right) {
    return null;
  }
  const exactX = (ev.clientX - rect.left) * cols / rect.width;
  const x = Math.max(0, Math.min(cols - 1, Math.floor(exactX)));
  return {
    point: {
      x,
      y,
      x_pixel_offset: Math.max(0, Math.floor((exactX - x) * rect.width / cols)),
      y_pixel_offset: Math.max(0, Math.floor(ev.clientY - rect.top)),
    },
    cellWidth: rect.width / cols,
    cellHeight: rect.height,
    visibleRows: visible,
  };
}

/**
 * Wire a pane container to ptyZZZ's {t:"mouse"} input protocol.
 *
 * send receives (paneName, frame). enabled can impose application-level focus
 * policy in addition to the terminal's own mouse-grab state.
 */
export function wirePtyMouse({
  root,
  send,
  enabled = () => true,
  paneFromEvent = ev => ev.target.closest?.(".pane"),
  paneName = pane => pane?.dataset.pane,
}) {
  const buttons = ["left", "middle", "right"];
  const wheel = new WeakMap();
  let active = null;
  let lastMove = "";

  const accepts = (pane, ev) =>
    !!pane && !ev.shiftKey && enabled(pane, ev) && grabbed(pane);

  function onDown(ev) {
    const pane = paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const button = buttons[ev.button];
    const name = paneName(pane);
    if (!hit || !button || !name) return;
    const eventMods = mods(ev);
    active = {pane, name, button, point: hit.point, mods: eventMods};
    send(name, {t: "mouse", kind: "press", button, ...hit.point, mods: eventMods});
    ev.preventDefault();
  }

  function release(ev) {
    if (!active) return;
    const hit = ev ? locate(active.pane, ev) : null;
    const point = hit?.point || active.point;
    const held = active;
    send(held.name, {
      t: "mouse",
      kind: "release",
      button: held.button,
      ...point,
      mods: ev ? mods(ev) : held.mods,
    });
    active = null;
    ev?.preventDefault();
  }

  function onUp(ev) {
    release(ev);
  }

  function onBlur() {
    release();
  }

  function onMove(ev) {
    const pane = active?.pane || paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const name = paneName(pane);
    if (!hit || !name) return;
    const eventMods = mods(ev);
    if (active) {
      active.point = hit.point;
      active.mods = eventMods;
    }
    const key = [
      name,
      hit.point.x,
      hit.point.y,
      hit.point.x_pixel_offset,
      hit.point.y_pixel_offset,
      eventMods,
    ].join(":");
    if (key === lastMove) return;
    lastMove = key;
    send(name, {t: "mouse", kind: "move", ...hit.point, mods: eventMods});
  }

  function onOut(ev) {
    const pane = paneFromEvent(ev);
    if (pane && !pane.contains(ev.relatedTarget)) lastMove = "";
  }

  function onWheel(ev) {
    const pane = paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const name = paneName(pane);
    if (!hit || !name) return;

    const state = wheel.get(pane) || {x: 0, y: 0};
    const page = hit.cellHeight * hit.visibleRows;
    const scale = ev.deltaMode === 1 ? hit.cellHeight : ev.deltaMode === 2 ? page : 1;
    state.x = Math.max(
      -20 * hit.cellWidth,
      Math.min(20 * hit.cellWidth, state.x + ev.deltaX * scale),
    );
    state.y = Math.max(
      -20 * hit.cellHeight,
      Math.min(20 * hit.cellHeight, state.y + ev.deltaY * scale),
    );

    const vertical = Math.abs(state.y / hit.cellHeight) >= Math.abs(state.x / hit.cellWidth);
    const unit = vertical ? hit.cellHeight : hit.cellWidth;
    const axis = vertical ? "y" : "x";
    let steps = Math.trunc(state[axis] / unit);
    if (!steps) {
      wheel.set(pane, state);
      ev.preventDefault();
      return;
    }
    steps = Math.max(-20, Math.min(20, steps));
    state[axis] -= steps * unit;
    const button = vertical
      ? (steps < 0 ? "wheelup" : "wheeldown")
      : (steps < 0 ? "wheelleft" : "wheelright");
    for (let i = 0; i < Math.abs(steps); i++) {
      send(name, {t: "mouse", kind: "press", button, ...hit.point, mods: mods(ev)});
    }
    wheel.set(pane, state);
    ev.preventDefault();
  }

  function onContextMenu(ev) {
    const pane = paneFromEvent(ev);
    if (accepts(pane, ev)) ev.preventDefault();
  }

  root.addEventListener("mousedown", onDown);
  root.addEventListener("mousemove", onMove);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("wheel", onWheel, {passive: false});
  root.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("mouseup", onUp, {capture: true});
  window.addEventListener("blur", onBlur);

  return () => {
    root.removeEventListener("mousedown", onDown);
    root.removeEventListener("mousemove", onMove);
    root.removeEventListener("mouseout", onOut);
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("mouseup", onUp, {capture: true});
    window.removeEventListener("blur", onBlur);
  };
}
