// A fetched response, read the same way by every fetcher a Resource has (the web and PDF fetchers in
// resource-catalog.ts, the remote-entity client in remote-entity.ts): its media type, the charset its text is in, and
// letting its body go when a check refuses it.

const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/;

/**
 * The response's media type, lowercased and without parameters; "" when it names none. A header holding several
 * (`, text/plain;charset=utf-8`: an empty one a server's default was added to) reads as the last one that is a media
 * type, as the Fetch standard extracts it (PIE-1694).
 */
export function responseMediaType(response: Response): string {
  const header = response.headers.get("content-type") ?? "";
  let mediaType = "";
  for (const value of header.split(",")) {
    const essence = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (MEDIA_TYPE.test(essence)) mediaType = essence;
  }
  return mediaType;
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
