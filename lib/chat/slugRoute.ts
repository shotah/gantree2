/** Re-wrap a Durable Object response so the Worker owns the body stream. */
export async function fromStub(res: Response): Promise<Response> {
  const buf = await res.arrayBuffer();
  const headers = new Headers();
  res.headers.forEach((v, k) => {
    headers.set(k, v);
  });
  return new Response(buf.byteLength ? buf : null, { status: res.status, headers });
}
