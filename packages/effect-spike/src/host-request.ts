// Slice C of the Effect 4 spike (not for merge): the door's `hostRequest` (packages/door/src/socket.ts) on Effect's
// Socket. The original is a hand-made Promise: connect, write one line, read until the first JSON line, a timer that
// destroys the socket, an error handler that rejects, and `Refused` for a service that answered `ok: false`. Four exits
// (answer, refusal, timeout, error), each of which must remember to clear the timer and destroy the socket.
//
// Here the socket is a scoped resource (`makeNet`: closed when the Scope ends, whichever way it ends), the timeout is a
// combinator, the answer line is decoded by slice B's `ResponseLine`, and each failure is a tagged error with the
// facts and the command. The caller sees `Effect<T, Refused | HostSilent | NoHost | BadAnswer>`.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeNet } from "@effect/platform-bun/BunSocket";
import { ResponseLine } from "./protocol";

/** The service answered with an error: it refused the request and wrote nothing. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { action: Schema.String, error: Schema.String }) {
  get message() { return this.error; }
}
/** Something listens at the socket but didn't answer in time: the outcome is unknown (this is why comment writes carry a requestId). */
export class HostSilent extends Schema.TaggedError<HostSilent>()("HostSilent", { action: Schema.String, path: Schema.String, timeoutMs: Schema.Int }) {
  get message() { return `${this.action} timed out after ${this.timeoutMs} ms (${this.path}) · \`${this.command}\` says whether the host is up`; }
  get command() { return "ep0ch status"; }
}
/** Nobody is at the socket, or it hung up before answering. */
export class NoHost extends Schema.TaggedError<NoHost>()("NoHost", { action: Schema.String, path: Schema.String, said: Schema.String }) {
  get message() { return `no outline host answers at ${this.path} (${this.said}) · \`${this.command}\` starts it`; }
  get command() { return "ep0ch install --apply"; }
}
/** The host answered, but not with a response line this client's PROTOCOL knows. */
export class BadAnswer extends Schema.TaggedError<BadAnswer>()("BadAnswer", { action: Schema.String, path: Schema.String, said: Schema.String }) {
  get message() { return `${this.action}: the outline host at ${this.path} answered something this client can't read (${this.said}) · \`ep0ch install --apply\` updates both sides`; }
}
export type HostRequestError = Refused | HostSilent | NoHost | BadAnswer;

/** `ping`'s answer, as the door would ask for it: `hostRequest(path, "ping", {}, { result: OutlinerServiceStatus })`. */
export { OutlinerServiceStatus } from "./protocol";


/** The longest answer line read before giving up on it. */
const LINE_LIMIT = 8 * 1024 * 1024;

/**
 * A request to the outline host itself (`outlines.*`, or `ping`), on a short connection of its own: one line out, the
 * first line back, the socket closed on every exit.
 */
export const hostRequest = Effect.fn("hostRequest")(function*<S extends Schema.Top = typeof Schema.Unknown>(
  path: string, action: string, params: Record<string, unknown> = {}, o: { timeoutMs?: number; result?: S } = {},
) {
  const timeoutMs = o.timeoutMs ?? 15_000;
  const result = (o.result ?? Schema.Unknown) as S;
  const ask = Effect.gen(function*() {
    const socket = yield* makeNet({ path });
    // The reader first: a fast answer that arrives before the reader is acquired is otherwise missed (found by the test).
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;
    // The envelope after the params: a caller's `{ action: ... }` can't rename the request (Codex; the door's original has the spread first).
    yield* writer.write(JSON.stringify({ ...params, id: "host", action }) + "\n");
    // One decoder per request (a streaming decoder holds half a character between chunks: shared, two requests would
    // mix), and every whole line in the buffer is looked at before pulling again (a blank line before the answer in
    // one chunk must not make us wait for a chunk that never comes). Both found by Codex's review of this spike.
    const text = new TextDecoder();
    let buf = "";
    for (;;) {
      for (const chunk of yield* reader.pull) buf += typeof chunk === "string" ? chunk : text.decode(chunk, { stream: true });
      // A line past LINE_LIMIT without its end is not an answer (the door's JsonLines has the same bound; Codex noticed this copy lacked it).
      if (buf.length > LINE_LIMIT && !buf.includes("\n")) return yield* new BadAnswer({ action, path, said: `a line over ${LINE_LIMIT} characters with no end` });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const r = yield* Schema.decodeUnknownEffect(ResponseLine)(line).pipe(Effect.mapError(e => new BadAnswer({ action, path, said: e.message.split("\n")[0] ?? "" })));
        if (!r.ok) return yield* new Refused({ action, error: r.error });
        return yield* Schema.decodeUnknownEffect(result)(r.result).pipe(Effect.mapError(e => new BadAnswer({ action, path, said: `result: ${e.message.split("\n")[0] ?? ""}` })));
      }
    }
  });
  return yield* ask.pipe(
    Effect.timeout(`${timeoutMs} millis`),
    Effect.catchTag("TimeoutError", () => new HostSilent({ action, path, timeoutMs })),
    // A socket that couldn't open, or closed before a line arrived: both are a SocketError, with the reason as its tag.
    Effect.catchTag("SocketError", e => new NoHost({ action, path, said: e.reason._tag })),
    Effect.scoped,
  );
});
