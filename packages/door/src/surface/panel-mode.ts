// The property panel's mode, including its settings face. Geometry stays with the attached surface.
import type { NoteSurface, SurfaceHost } from "./note";
import type { ReaderMode } from "./modes";
import type { PropertyPanel, PropRow } from "./props-panel";
import type { Key } from "../term";
import { completerOf } from "./completer";
import { scrolled } from "../scroll";

type PanelMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { panel: PropertyPanel; describe(): { open: string; selected: number; note: string | null; editing: unknown; rows: unknown[] } | null };

export function panelMode(surface: NoteSurface, P: PropertyPanel, key: (k: Key, host: SurfaceHost) => boolean,
  hitAt: (x: number, y: number) => { prop: number; follow: boolean } | null,
  offset: (host: SurfaceHost) => number, describeRow: (row: PropRow) => unknown): PanelMode {
  const mode: PanelMode = {
      name: "panel", of: P, panel: P, holdsKeys: true, noun: "the property value",
      word: "property panel",
      changed: (revision, partial) => {
        // A list row's revision says nothing about the value's token: only a whole read marks it.
        const f = P.field;
        if (partial || !f || f.saving || revision === f.revision) return;
        f.changedElsewhere = true;
        f.note = "the note changed elsewhere since this value was read · saving would be refused · esc, then enter edits the current value";
      },
      editing: () => !!P.field, covers: () => P.full,
      key: (k, host) => key(k, host),
      click: (x, y, host) => {
        // A value being typed keeps the reader's clicks, but for a candidate of its completion popup (PIE-626); a click on a row selects it (on its value, follows it).
        if (P.field) return completerOf(P.field.input)?.click(y, x) ?? false;
        if (P.card) {
          if (P.card.place === "tile" && host.attachment !== "settings") return undefined;
          const hit = P.card.hit(x, y + (P.card.place === "inline" ? 0 : offset(host)));
          void surface.runKey("settings.focus", { on: hit !== null }, host);
          if (hit === null) return undefined;
          if (hit === "place") void surface.runKey("settings.place", {}, host);
          else if (typeof hit === "number") {
            const f = surface.msg && surface.settingFields(surface.msg, P.card.schemas)[hit - 1];
            if (f && P.card.sel === hit - 1) void surface.runKey("settings.set", { key: f.prop.key }, host);
            else void surface.runKey("settings.pick", { n: hit }, host);
          }
          return true;
        }
        const h = hitAt(x, y);
        if (!h) return undefined;
        const m = surface.msg, r = m ? surface.rows(m)[h.prop - 1] : undefined;
        if (!r) return false;
        if (surface.selection) void surface.runKey("select.clear", {}, host);
        P.sel = h.prop - 1; P.note = "";
        if (h.follow) void surface.runKey("props.follow", { n: r.n }, host, true);
        host.redraw();
        return true;
      },
      wheel: (dir, host, at) => {
        if (P.card) { if (!at || P.card.hit(at.x, at.y) === null) return false; void surface.runKey("settings.pick", { by: dir }, host); return true; }
        const m = surface.msg;
        if (!P.full || !m || m.partial || P.field) return false;
        const n = surface.rows(m).length;
        if (n) P.sel = scrolled(P.sel, dir, n - 1);
        return true;
      },
      // Drawn by the reading render: above the note, or filling the reader under its header (full).
      rows: () => null,
      leave: async host => { if (P.field) { P.field = null; host.redraw(); } return { left: "nothing" }; },
      leaveRefusal: () => { const f = P.field; return f && f.input.text !== f.row.value ? "finish the property value first · ⏎ saves · esc cancels" : null; },
      unsaved: () => !!P.field && P.field.input.text !== P.field.row.value,
      hint: () => (P.card ? P.card.hint() : P.hint()),
      state: () => (P.card ? "settings" : P.field ? "editing a property" : "properties"),
      describe: () => {
        const m = surface.msg;
        if (m && P.card) {
          return { open: "settings", place: P.card.place, schemas: P.card.schemas.map(s => s.id), selected: P.card.sel + 1, note: P.card.note || null, editing: null,
            fields: surface.settingFields(m, P.card.schemas).map(f => ({ n: f.n, section: P.card!.schemas[f.section]!.id, key: f.prop.key, type: f.prop.type, value: f.value, ...(f.prop.default !== undefined ? { default: f.prop.default } : {}) })), rows: [] };
        }
        return m ? {
          open: P.full ? "full" : "inline", selected: P.sel + 1, note: P.note || null,
          editing: P.field ? { n: P.field.row.n, key: P.field.row.key, text: P.field.input.text, revision: P.field.revision, changedElsewhere: P.field.changedElsewhere, note: P.field.note || null } : null,
          rows: surface.rows(m).map(r => describeRow(r)),
        } : null;
      },
    };
  return mode;
}
