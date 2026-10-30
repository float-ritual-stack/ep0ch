import { describe, expect, test } from "bun:test";
import { actorHandle, actorLabel, actorName, composeActor, parseActor, revisionByline } from "../src/attribution";

describe("attribution", () => {
  test("a persona rides on its principal and is shown with it", () => {
    const id = composeActor({ persona: "loki", principal: "claude-code@float-2", mcp: true });
    expect(id).toBe("mcp:loki/claude-code@float-2");
    expect(parseActor(id)).toMatchObject({ persona: "loki", principal: "claude-code@float-2", handle: "loki", mcp: true });
    expect(actorLabel(id)).toBe("loki (claude-code@float-2)");
  });
  test("a principal alone is its own label; a persona equal to the client is none", () => {
    expect(composeActor({ principal: "claude.ai", mcp: true })).toBe("mcp:claude.ai");
    expect(composeActor({ persona: "claude.ai", principal: "claude.ai", mcp: true })).toBe("mcp:claude.ai");
    expect(actorLabel("mcp:claude.ai")).toBe("claude.ai");
    expect(actorLabel("claude-code@laptop")).toBe("claude-code@laptop");
    expect(actorHandle("mcp:claude-code@laptop")).toBe("claude-code");
  });
  test("older ids parse as they were", () => {
    expect(parseActor("claude-code")).toEqual({ handle: "claude-code", label: "claude-code", mcp: false });
    expect(actorHandle("mcp:daddy")).toBe("daddy");
    expect(actorLabel("evan")).toBe("evan");
    expect(actorLabel("ext:graphs")).toBe("ext:graphs");
    expect(actorLabel("a/b/c d")).toBe("a/b/c d");
  });
  test("a byline shows the persona first; the full label keeps the principal; co-writers are each named", () => {
    expect(actorName("mcp:loki/claude-code@float-2")).toBe("loki");
    expect(actorName("kitty/claude-code@float-2")).toBe("kitty");
    expect(actorName("claude-code@float-2")).toBe("claude-code@float-2");
    expect(actorName("mcp:claude.ai")).toBe("claude.ai");
    expect(actorName("ext:echonet")).toBe("ext:echonet");
    expect(actorName("ep0ch-door:box-a+wren/claude-code@box-a")).toBe("ep0ch-door:box-a + wren");
    expect(actorLabel("ep0ch-door:box-a+wren/claude-code@box-a")).toBe("ep0ch-door:box-a + wren (claude-code@box-a)");
  });

  test("a script run somebody asked for reads as them, via script; the script's own writes read as the script (PIE-1462)", () => {
    expect(revisionByline({ author: "user", taskId: "trigger:script:script-1a2b" })).toBe("by you · via script");
    expect(revisionByline({ author: "agent", actorId: "kitty", taskId: "trigger:script:script-1a2b+via:yolo" })).toBe("by kitty · via script · for evan · via yolo");
    expect(revisionByline({ author: "agent", actorId: "script:neat", taskId: "trigger:script:script-1a2b" })).toBe("by script:neat");
    expect(revisionByline({ author: "user" })).toBe("by you");
  });
});
