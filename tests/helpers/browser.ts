import { handleGetExperiment, handleWater } from "@/lib/handlers";

/**
 * A tiny stand-in for a real browser: it keeps a cookie jar and talks to the
 * real route handlers with real Request/Response objects. Each Browser has its
 * own IP so rate limits only trigger when a test wants them to.
 */

// Response bodies are arbitrary decoded JSON that each test asserts on, so a loose
// type is the honest one here; production code never uses `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
  setCookies: string[];
}

let counter = 0;

export class Browser {
  cookie: string | null = null;
  hint: string | undefined;
  readonly ip: string;

  constructor(opts: { ip?: string; hint?: string } = {}) {
    counter += 1;
    this.ip = opts.ip ?? `10.${Math.floor(counter / 60000) % 250}.${Math.floor(counter / 250) % 250}.${(counter % 250) + 1}`;
    this.hint = opts.hint;
  }

  private baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "x-forwarded-for": this.ip,
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...(this.hint ? { "x-visitor-hint": this.hint } : {}),
      ...extra,
    };
  }

  private async absorb(res: Response): Promise<Reply> {
    const setCookies = res.headers.getSetCookie();
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      if (pair.startsWith("he_visitor=")) this.cookie = pair;
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers, setCookies };
  }

  async get(path = "/api/experiment", headers: Record<string, string> = {}): Promise<Reply> {
    const res = await handleGetExperiment(
      new Request(`http://localhost:3000${path}`, { headers: this.baseHeaders(headers) }),
    );
    return this.absorb(res);
  }

  async water(body: unknown = {}, headers: Record<string, string> = {}): Promise<Reply> {
    return this.postRaw(JSON.stringify(body), { "content-type": "application/json", ...headers });
  }

  async postRaw(raw: string, headers: Record<string, string> = {}): Promise<Reply> {
    const res = await handleWater(
      new Request("http://localhost:3000/api/water", {
        method: "POST",
        body: raw,
        headers: this.baseHeaders({ origin: "http://localhost:3000", ...headers }),
      }),
    );
    return this.absorb(res);
  }

  /** Simulates the browser dropping its cookie (expired / cleared). */
  forgetCookie() {
    this.cookie = null;
  }
}
