// Soft links on a published page (PIE-408): a value left in the prose and a date link where their page is published.
// A pull request's project is the note's context, which a page's words don't carry here, so it stays the words it is.
import { tryNormalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { softLinkTokens, type SoftLinkToken } from "@ep0ch/outline-core/soft-links";

/** The page address a soft link names by its words alone, normalized; null for a pull request. */
const softPageAddress = (token: SoftLinkToken): string | null =>
  token.kind === "pr" ? null : tryNormalizePageAddress(token.kind === "date" ? token.day : token.value)?.normalizedAddress ?? null;

export const softPageAddresses = (text: string): string[] => softLinkTokens(text).flatMap(token => softPageAddress(token) ?? []);

/** `body` with each soft link whose page is published linked, by `link`, as a page link is. */
export function linkSoftWords<E>(body: string, pages: ReadonlyMap<string, string>, entries: ReadonlyMap<string, E>, link: (label: string, target: E | undefined) => string, inCode: (offset: number) => boolean): string {
  for (const token of softLinkTokens(body).reverse()) {
    const address = softPageAddress(token), blockId = address ? pages.get(address) : undefined, target = blockId ? entries.get(blockId) : undefined;
    if (target && !inCode(token.start)) body = body.slice(0, token.start) + link(body.slice(token.start, token.end), target) + body.slice(token.end);
  }
  return body;
}
