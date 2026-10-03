import { expect, test } from "bun:test";
import {
  selectLinkedDetailClient,
  selectTreeClient,
  selectTreeClientForInvocation,
} from "../src/herdr-open-policy";
import type { OutlinerClientRegistration } from "../src/types";

const trees: OutlinerClientRegistration[] = [
  {
    clientId: "tree-a",
    role: "tree",
    contextId: "tree-a",
    runtime: { paneId: "pane-a", tabId: "tab-a", workspaceId: "workspace" },
  },
  {
    clientId: "tree-b",
    role: "tree",
    contextId: "tree-b",
    runtime: { paneId: "pane-b", tabId: "tab-b", workspaceId: "workspace" },
  },
];

test("focus-existing requires an explicit Tree when several are live", () => {
  expect(() => selectTreeClient(trees)).toThrow(
    "Multiple live Tree clients are registered; choose --client: tree-a, tree-b",
  );
  expect(selectTreeClient(trees, "tree-b")).toBe(trees[1]);
});

test("focus-existing rejects missing and stale Tree client identities", () => {
  expect(() => selectTreeClient([])).toThrow("No live Tree client is registered");
  expect(() => selectTreeClient(trees, "tree-stale")).toThrow(
    "Requested Tree client is not registered: tree-stale",
  );
});

test("selects the Tree in the invoking tab before considering other live Trees", () => {
  expect(selectTreeClientForInvocation(trees, {
    paneId: "shell-b",
    tabId: "tab-b",
    workspaceId: "workspace",
  })).toBe(trees[1]);
  expect(selectTreeClientForInvocation(trees, {
    paneId: "pane-a",
    tabId: "tab-b",
  })).toBe(trees[0]);
});

test("reuses only the linked logical Detail regardless of context or geometry", () => {
  const clients: OutlinerClientRegistration[] = [
    {clientId: "near", role: "detail", contextId: "shared", runtime: {tabId:"tab",paneX:0,paneY:0}},
    {clientId: "linked", role: "composed", contextId: "other", runtime: {tabId:"moved-tab",paneX:500,paneY:500}},
    {clientId: "observer", role: "observer", contextId: "shared"},
  ];
  expect(selectLinkedDetailClient(clients, {clientId:"linked",region:"detail"})).toBe(clients[1]);
  expect(selectLinkedDetailClient(clients, null)).toBeUndefined();
  expect(() => selectLinkedDetailClient(clients, {clientId:"closed",region:"detail"})).toThrow("Linked destination is unavailable");
  expect(() => selectLinkedDetailClient(clients, {clientId:"observer",region:"detail"})).toThrow("Linked destination is unavailable");
});
