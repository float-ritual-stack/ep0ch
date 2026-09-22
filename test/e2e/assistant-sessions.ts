import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { OutlinerClient } from "../../src/client";
import { OutlinerServer } from "../../src/server";
import { OutlinerStore } from "../../src/store";
import { createInboxModel } from "../../src/inbox-model";
import type { InboxStatus } from "../../src/inbox-types";
import { runHerdrScenario } from "./herdr-runner";

// Real Pi tools, sessions, service and terminals; only provider responses are
// deterministic. This proves runtime/inspection behavior, not model quality.
const result = await runHerdrScenario({
  name: "assistant-sessions",
  async prepare(projectRoot, paths) {
    await mkdir(paths.stateDir, { recursive: true });
    const agentDir = join(paths.stateDir, "fixture-agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4.1", defaultThinkingLevel: "off" }));
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "local-fixture-no-network" } }));
    const store = new OutlinerStore(paths.database, { workspaceRoot: projectRoot });
    const server = new OutlinerServer(store, paths.socket);
    const client = new OutlinerClient(paths.socket);
    try {
      await server.start();
      server.enableInbox(createInboxModel({ workspaceRoot: projectRoot, agentDir, jevApiKey: "", timeoutMs: 400,
        sessionDirectory: join(paths.stateDir, "assistant-sessions"),
        stream(_model, context) {
          const stream = createAssistantMessageEventStream();
          const user = context.messages.find(message => message.role === "user");
          assert.ok(user?.role === "user" && typeof user.content === "string");
          const source = JSON.parse(user.content).source;
          const last = context.messages.at(-1)!;
          if (last.role === "toolResult" && source.text.includes("PIE311 timeout")) return stream;
          const tool: ToolCall = { type: "toolCall", id: crypto.randomUUID(),
            name: last.role === "user" ? "search_notes" : "finish_cleanup",
            arguments: last.role === "user" ? { query: "PIE311 context" } : {
              summary: "Filed fixture note", source: { text: source.text, disposition: "file" }, notes: [], tasks: [], updates: [],
            },
          };
          const message: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "openai", model: "gpt-4.1",
            content: [tool], stopReason: "toolUse", timestamp: Date.now(),
            usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          };
          stream.push({type:"done",reason:"toolUse",message});stream.end();return stream;
        },
      }));
      for (const [index, title] of ["PIE311 success", "PIE311 timeout"].entries()) {
        await client.request({action:"capture.create",requestId:title,source:"cli",text:`${title}\nRetain these words.`});
        let settled = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const status = await client.request<InboxStatus>({action:"inbox.status"});
          if (!status.current && status.results.length === index + 1) { settled = true; break; }
          await Bun.sleep(25);
        }
        assert.ok(settled, "SDK fixture did not settle");
      }
      const status = await client.request<InboxStatus>({action:"inbox.status"});
      assert.equal(status.results[0]!.state,"failed");
      assert.equal(status.results[1]!.state,"applied");
      for (const receipt of status.results) assert.ok(receipt.usage?.piSessions?.[0]?.path);
    } finally { await server.close();store.close(); }
  },
  async run(session) {
    const tree = session.panes.tree;
    const detail = session.panes.detail;
    const status = await session.client.request<InboxStatus>({action:"inbox.status"});
    for (const receipt of status.results) {
      const saved = receipt.usage!.piSessions![0]!;
      const native = await readFile(saved.path!,"utf8");
      await session.record(`session-${saved.outcome}`,native);
      const child = Bun.spawn([process.execPath,"-e",`
        import {SessionManager} from "@earendil-works/pi-coding-agent";
        const s=SessionManager.open(process.argv[1]);console.log(JSON.stringify({id:s.getSessionId(),entries:s.getEntries().length}));
      `,saved.path!],{cwd:process.cwd(),stdout:"pipe",stderr:"pipe"});
      const reopened = JSON.parse(await new Response(child.stdout).text());
      assert.equal(await child.exited,0);assert.equal(reopened.id,saved.id);assert.ok(reopened.entries>3);
    }
    await session.keys(tree,"I");
    await session.waitVisible(tree,"failed · PIE311 timeout");
    await session.waitVisible(tree,"Pi session 1");
    await session.checkpoint("01-timeout-session-discoverable");
    await session.keys(tree,"t");
    await session.waitVisible(detail,"outliner-attempt");
    await session.checkpoint("02-timeout-native-file-in-detail");
    await session.keys(tree,"I");
    await session.waitVisible(tree,"Inbox agent");
    await session.keys(tree,"a");
    await session.waitVisible(tree,"Recent results: 1–2");
    await session.keys(tree,"down");
    await session.waitVisible(tree,"› applied · PIE311 success");
    await session.keys(tree,"t");
    const successful=status.results.find(r=>r.state==="applied")!.usage!.piSessions![0]!;
    await session.waitVisible(detail,successful.id);
    await session.checkpoint("03-success-native-file-in-detail");
    await session.record("retained-results",status.results);
  },
});
console.log(JSON.stringify(result));
if(result.status!=="passed")process.exitCode=1;
