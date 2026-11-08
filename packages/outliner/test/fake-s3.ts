// A fake S3 for the media bucket's tests (PIE-1634): an in-process server answering path-style PUT, HEAD and GET on
// `/<bucket>/<key>`, holding objects in memory and counting uploads. It checks only that a request is signed (an
// Authorization header, or a presigned query) and never sees a real key. Never a real bucket.
export interface FakeS3 { url: string; bucket: string; puts: string[]; objects: Map<string, { bytes: Uint8Array; type: string }>; env: Record<string, string>; stop(): void }

export function fakeS3(bucket = "scratch-media"): FakeS3 {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>(), puts: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const signed = request.headers.has("authorization") || url.searchParams.has("X-Amz-Signature");
      if (!signed) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
      const prefix = `/${bucket}/`;
      if (!url.pathname.startsWith(prefix)) return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      if (request.method === "PUT") {
        objects.set(key, { bytes: new Uint8Array(await request.arrayBuffer()), type: request.headers.get("content-type") ?? "application/octet-stream" });
        puts.push(key);
        return new Response(null, { status: 200, headers: { etag: '"fake"' } });
      }
      const object = objects.get(key);
      if (!object) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      return new Response(request.method === "HEAD" ? null : object.bytes, { headers: { "content-type": object.type, "content-length": String(object.bytes.length) } });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url, bucket, puts, objects,
    env: { EP0CH_MEDIA_BUCKET: bucket, EP0CH_MEDIA_ENDPOINT: url, EP0CH_MEDIA_REGION: "scratch-1", AWS_ACCESS_KEY_ID: "fake-key-id", AWS_SECRET_ACCESS_KEY: "fake-secret", WITH_SECRETS_DIR: "/nonexistent" },
    stop: () => { void server.stop(true); },
  };
}
