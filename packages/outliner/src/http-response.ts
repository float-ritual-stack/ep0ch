// A fetched response, read the same way by every fetcher a Resource has (the web and PDF fetchers in
// resource-catalog.ts, the remote-entity client in remote-entity.ts): its media type, and letting its body go when a
// check refuses it.

/** The response's media type, lowercased and without parameters; "" when it names none. */
export function responseMediaType(response: Response): string {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/** Lets the body go unread; a body that can't be cancelled leaves the refusal that asked for it standing. */
export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the provider validation error when a body cannot be cancelled.
  }
}
