import handler from "vinext/server/fetch-handler";

// The application uses ASSETS for private R2 artwork. vinext receives only the
// static-file service under its conventional name; cloudflare:workers.env keeps
// the actual R2 binding for authenticated application routes.
const worker = {
  async fetch(
    request: Request,
    env: { STATIC_ASSETS: { fetch(request: Request): Promise<Response> } },
    ctx: Parameters<typeof handler.fetch>[2],
  ) {
    const response = await handler.fetch(
      request,
      { ASSETS: env.STATIC_ASSETS },
      ctx,
    );
    const length = response.headers.get("X-Storybook-Artwork-Length");
    if (length === null) return response;
    const headers = new Headers(response.headers);
    headers.delete("X-Storybook-Artwork-Length");
    if (!response.body || response.status !== 200 || !/^\d+$/.test(length))
      return new Response(response.body, { status: response.status, headers });
    const { FixedLengthStream } = globalThis as unknown as {
      FixedLengthStream: new (
        length: number,
      ) => TransformStream<Uint8Array, Uint8Array>;
    };
    // Framework wrapping loses known-length stream metadata. Enforce framing
    // after that wrapping, without buffering artwork inside a Worker isolate.
    const fixed = new FixedLengthStream(Number(length));
    void response.body
      .pipeTo(fixed.writable)
      .catch(() => console.error("R2 artwork transfer failed."));
    headers.set("Content-Length", length);
    return new Response(fixed.readable, { status: response.status, headers });
  },
};
export default worker;
