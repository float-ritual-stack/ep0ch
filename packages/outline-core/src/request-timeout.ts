// How long a client waits for the host's answer: the caller's default (short, for a keypress), unless whoever runs it
// says longer. EP0CH_REQUEST_TIMEOUT_MS is that say for a batch reader on a loaded box (PIE-1597): the door's SocketBoard
// CLI and the outliner's client read it here, so the two agree. A request's own explicit wait is untouched.

/** `EP0CH_REQUEST_TIMEOUT_MS` when it is a positive number of milliseconds, else `fallback`. */
export function requestTimeoutMs(env: Readonly<Record<string, string | undefined>>, fallback: number): number {
  const ms = Number(env.EP0CH_REQUEST_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}
