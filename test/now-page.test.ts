// The "now" page: the welcome screen (with no welcome notes) and the daily layout's "now" tile show
// [[claude-now]] unless EP0CH_NOW_PAGE names another page.
import { expect, test } from "bun:test";
import { nowPage } from "../src/hub/now";

test("claude-now by default; EP0CH_NOW_PAGE names another page, labelled by its name or EP0CH_NOW_LABEL", () => {
  expect(nowPage({})).toEqual({ address: "claude-now", label: "Claude · now" });
  expect(nowPage({ EP0CH_NOW_PAGE: " morning-notes " })).toEqual({ address: "morning-notes", label: "morning-notes" });
  expect(nowPage({ EP0CH_NOW_PAGE: "morning-notes", EP0CH_NOW_LABEL: "Morning" })).toEqual({ address: "morning-notes", label: "Morning" });
  expect(nowPage({ EP0CH_NOW_PAGE: "  " }).address).toBe("claude-now");
});
