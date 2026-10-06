import { join } from "node:path";

/** A fictional outline host on a unix socket: answers by action, counts connections and how many are still open. */
export function fakeHost(dir: string) {
  const path = join(dir, "host.sock");
  let opened = 0, open = 0;
  const outlines = [
    { name: "jam-shelf", database: "/home/sam/outlines/jam-shelf.sqlite", folder: "/home/sam/outlines/jam-shelf", open: true, default: true },
    { name: "garden", database: "/home/sam/outlines/garden.sqlite", folder: "/home/sam/outlines/garden", open: false },
  ];
  const server = Bun.listen({
    unix: path,
    socket: {
      open() { opened++; open++; },
      close() { open--; },
      data(sock, d) {
        const req = JSON.parse(Buffer.from(d).toString().trim());
        const ok = (result: unknown) => sock.write(JSON.stringify({ id: req.id, ok: true, result, sequence: 1 }) + "\n");
        const no = (error: string) => sock.write(JSON.stringify({ id: req.id, ok: false, error, sequence: 1 }) + "\n");
        if (req.action === "ping") ok({ status: "ready" });
        else if (req.action === "outlines.list") ok({ defaultOutline: "jam-shelf", outlines });
        else if (req.action === "outlines.create") req.name === "garden" ? no(`"garden" exists already`) : ok({ name: req.name, database: `/home/sam/outlines/${req.name}.sqlite`, folder: `/home/sam/outlines/${req.name}`, open: true });
        else if (req.action === "outlines.delete") ok({ name: req.name, movedTo: `/home/sam/outlines/.trash/${req.name}` });
        else if (req.action === "garbled") sock.write("{\"id\":\"host\",\"ok\":true}\n");
        else if (req.action === "hangup") sock.end();
        // "slow": never answers
      },
    },
  });
  return { path, server, get opened() { return opened; }, get open() { return open; } };
}
