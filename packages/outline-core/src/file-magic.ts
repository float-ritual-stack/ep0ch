// What a picture or a document is by its first bytes (PIE-1408): the one place that reads a file's magic, for a file
// that arrives with no name (a phone's share, a pasted picture). Pure.

const ascii = (head: Uint8Array, from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** The file extension `head` (a file's first 12 bytes or more) says, with its dot: `.pdf`, `.png`, …; undefined when it says none. */
export function extensionOfBytes(head: Uint8Array): string | undefined {
  if (ascii(head, 0, 5) === "%PDF-") return ".pdf";
  if (head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return ".png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return ".jpg";
  if (ascii(head, 0, 4) === "GIF8") return ".gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return ".webp";
  if (ascii(head, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(head, 8, 12))) return ".heic";
  return undefined;
}
