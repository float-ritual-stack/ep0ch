import { describe, expect, test } from "bun:test";
import { actorHandle, actorLabel, composeActor, parseActor } from "../src/attribution";

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
});
