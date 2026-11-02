// The what-changed extension's one action (PIE-1506): `change` opens the picked row's note with its last change beside
// it, through the door's revision compare (`open` with compare). The rows themselves are the render script's.
const request = (await Bun.stdin.json()) as { operation: string; input: { action: string; target?: { blockId?: string } } };
const reply = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
if (request.operation !== "act" || request.input.action !== "change") process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
else if (!request.input.target?.blockId) process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
else reply({ open: request.input.target.blockId, compare: true, message: "the change, beside the note" });
