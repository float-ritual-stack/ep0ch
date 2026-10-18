import { join } from "node:path";
import { artifactResponse } from "./artifact-server";
import { ArtifactStore } from "./artifact-store";

const outlines = process.env.EP0CH_OUTLINES ?? join(process.env.HOME!, "outlines");
if (process.argv[2] === "watch") {
  const store = new ArtifactStore(outlines);
  store.startWatcher();
  process.on("SIGTERM", () => { store.close(); process.exit(0); });
} else {
  const host = process.env.EP0CH_ARTIFACT_HOST ?? "127.0.0.1";
  const port = Number(process.env.EP0CH_ARTIFACT_PORT ?? 8796);
  const ancestors = process.env.EP0CH_ARTIFACT_FRAME_ANCESTORS ?? "'none'";
  Bun.serve({ hostname: host, port, fetch: request => artifactResponse(join(outlines, ".artifacts"), request, ancestors) });
  console.log(`Artifacts listening on ${host}:${port}`);
}
