// Next.js resolves "server-only" to an empty module on the server. In Vitest
// (plain Node) the real package throws on import, so tests alias it to this stub.
export {};
