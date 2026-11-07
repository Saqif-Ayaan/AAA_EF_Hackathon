/**
 * Small helpers shared by the source tools: env lookup, a fetch with a timeout
 * that throws readable errors, and HTML-to-text.
 */

/** Read a required env var, with a hint about where to set it. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to .env.local (see .env.example).`);
  return value;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(message);
  }
}

/** fetch() with a timeout. Throws HttpError on a non-2xx response, with the start of the body. */
export async function fetchOk(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, {
    ...rest,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new HttpError(`${res.status} ${res.statusText} from ${url}${body ? `: ${body}` : ""}`, res.status, res.headers);
  }
  return res;
}

export async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetchOk(url, init);
  return (await res.json()) as T;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML page (scripts, styles, nav and header removed), whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
