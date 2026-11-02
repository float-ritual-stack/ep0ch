import { componentBlocks, COMPONENT_OPEN, splitWords } from "@ep0ch/outline-core/component-block";
import { viewSpec } from "@ep0ch/outline-core/view-spec";
import type { Msg } from "../board";
import { EditConflict, type Actor, type SocketBoard } from "../socket";
import { ActionRefused } from "./actions";
import { agentRefusal } from "../draft-session";
import type { ListHandle } from "./list-view";

export type Binding = NonNullable<ListHandle["binding"]>;

export function boundComponent(note: Msg, binding: Binding) {
  const ref = binding.component, lines = note.text.split("\n");
  if (!ref) return null;
  const blocks = componentBlocks(lines);
  const block = blocks.find(b => ref.id ? b.id === ref.id : b.start === ref.line);
  const spec = block && viewSpec(block, lines);
  return block && spec ? { block, lines, props: spec.props } : null;
}

/** Only the chosen field changes; the component's other words, body and anchor stay as authored. */
function componentValue(note: Msg, binding: Binding, key: string, value: string | null): string {
  const component = boundComponent(note, binding);
  if (!component) throw new ActionRefused("the view's source changed · open its settings again");
  const { block, lines } = component;
  const open = COMPONENT_OPEN.exec(lines[block.start]!)!, attrs = open[3];
  const fences = lines.slice(block.start + 1, block.end).flatMap((line, i) => /^\s*---\s*$/.test(line) ? [block.start + 1 + i] : []);
  const yamlStart = fences[0], yamlEnd = fences[1];
  if (yamlStart !== undefined && yamlEnd !== undefined) {
    const first = lines.slice(yamlStart + 1, yamlEnd).find(line => line.trim() && !line.trimStart().startsWith("#"));
    const indent = first?.match(/^\s*/)![0] ?? "";
    const yamlKey = lines.findIndex((line, i) => i > yamlStart && i < yamlEnd && line.startsWith(`${indent}${key}:`));
    if (yamlKey >= 0) {
      let end = yamlKey + 1;
      while (end < yamlEnd) {
        const line = lines[end]!, content = line.trimStart();
        if (content && !content.startsWith("#") && line.length - content.length <= indent.length && !/^-(?:\s|$)/.test(content)) break;
        end++;
      }
      const comments = lines.slice(yamlKey + 1, end).filter(line => !line.trim() || line.trimStart().startsWith("#"));
      lines.splice(yamlKey, end - yamlKey, ...(value === null ? [] : [`${indent}${key}: ${JSON.stringify(value)}`]), ...comments);
      if (value !== null) return lines.join("\n");
    } else if (!attrs && value !== null) {
      lines.splice(yamlEnd, 0, `${indent}${key}: ${JSON.stringify(value)}`);
      return lines.join("\n");
    }
  }
  const line = lines[block.start]!, inner = attrs?.slice(1, -1) ?? "";
  const words = splitWords(inner, false, false).flat();
  let cursor = 0, after = inner, replaced = false;
  const located = words.map(word => { const start = inner.indexOf(word.raw, cursor); cursor = start + word.raw.length; return { word, start, end: cursor }; });
  for (const token of located.toReversed()) {
    if (token.word.value.split("=")[0] !== key) continue;
    const replacement = !replaced && value !== null ? `${key}=${JSON.stringify(value)}` : "";
    let { start, end } = token;
    if (!replacement) {
      if (start) { while (start > 0 && /\s/.test(inner[start - 1]!)) start--; }
      else { while (end < inner.length && /\s/.test(inner[end]!)) end++; }
    }
    after = after.slice(0, start) + replacement + after.slice(end);
    replaced = true;
  }
  if (!replaced && value !== null) after = [after.trimEnd(), `${key}=${JSON.stringify(value)}`].filter(Boolean).join(" ");
  const at = attrs ? line.indexOf(attrs) : line.indexOf(`::${block.name}`) + block.name.length + 2;
  lines[block.start] = line.slice(0, at) + `{${after}}` + line.slice(at + (attrs?.length ?? 0));
  return lines.join("\n");
}

/** One attributed write at the subject's read revision, for settings now and row bindings next. */
export async function setBinding(board: SocketBoard, note: Msg, binding: Binding, key: string, value: string | null, actor: Actor): Promise<Msg> {
  const no = agentRefusal(actor, { board, blockId: note.id });
  if (no) throw new ActionRefused(no);
  if (note.revision === undefined) throw new ActionRefused("the note's revision is unknown · open its settings again");
  if (binding.component) return board.update(note.id, componentValue(note, binding, key, value), note.revision, actor);
  const tokens = await board.propertyTokens(note.id, key);
  if (tokens.revision !== note.revision) throw new EditConflict(note.id, "changed since the settings were read");
  const own = tokens.tokens.filter(t => t.scope === "block");
  const operations = value === null ? own.map(t => ({ op: "remove" as const, ordinal: t.ordinal }))
    : own.length ? [{ op: "replace" as const, ordinal: own[0]!.ordinal, value }, ...own.slice(1).map(t => ({ op: "remove" as const, ordinal: t.ordinal }))]
    : [{ op: "append" as const, key, value }];
  return operations.length ? board.patchProperties(note.id, note.revision, operations, actor) : note;
}
