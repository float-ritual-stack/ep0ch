// How long a batch reader waits for the host's answer on a loaded box (PIE-1597): EP0CH_REQUEST_TIMEOUT_MS, read only at
// the bulk command lines (`ep0ch export`, `find`, `mirror`, the outliner CLI), each of which hands the wait to its client.
// An interactive client never reads it: a keypress keeps its short wait with the variable set.

/** `EP0CH_REQUEST_TIMEOUT_MS` when it is a positive number of milliseconds, else undefined: the client's own default. */
export function requestTimeoutMs(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const ms = Number(env.EP0CH_REQUEST_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}
