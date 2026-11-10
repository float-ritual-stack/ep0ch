// A fetched response, read the same way by every fetcher a Resource has (the web and PDF fetchers in
// resource-catalog.ts, the remote-entity client in remote-entity.ts): its media type, the charset its text is in, and
// letting its body go when a check refuses it.

/** The response's media type, lowercased and without parameters; "" when it names none. */
export function responseMediaType(response: Response): string {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/** A decoder for the charset the response names (`text/html; charset=ISO-8859-1`); UTF-8 when it names none or one unknown. */
export function responseDecoder(response: Response): TextDecoder {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder();
  }
}

/** Lets the body go unread; a body that can't be cancelled leaves the refusal that asked for it standing. */
export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the provider validation error when a body cannot be cancelled.
  }
}
