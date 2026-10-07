// A rule on a text pattern (PIE-600): the service tests every line of every note against `match.text`, never inside
// a code fence, a code span, a literal region or a property token, and asks this program what to draw in the place
// of each line it hits. The line itself stays as written: `R` in the door shows it.

interface Request {
  operation: "decorate";
  input: { rule: string; hit: { at: "text"; line: number; text: string; captures: string[] } };
}

const request = (await Bun.stdin.json()) as Request;
const words = (request.input.hit.captures[1] ?? request.input.hit.text).trim();
process.stdout.write(JSON.stringify({ ok: true, value: {
  title: words,
  // The heading style "tab" letters it in capitals; the band takes the dots, centred, the words on the middle row.
  view: { type: "band", text: words.toUpperCase(), level: 2, style: "tab", pattern: "dots", align: "center", row: "middle", tone: "warn" },
} }));
