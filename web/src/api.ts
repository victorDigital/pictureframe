const TOKEN_KEY = "frame.bearer";

export class ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  network = false;
  timeout = false;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      details?: unknown;
      network?: boolean;
      timeout?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.network = Boolean(opts.network);
    this.timeout = Boolean(opts.timeout);
    this.cause = opts.cause;
  }
}

type ApiInit = RequestInit & { timeoutMs?: number };

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = unknown>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, signal: controller.signal });
  } catch (err) {
    const timeoutHit = controller.signal.aborted && !init.signal?.aborted;
    throw new ApiError(
      timeoutHit
        ? "Frame API did not respond in time. The change may still have been saved; refresh once the frame is reachable."
        : "Could not reach frame-core. Check that the frame is online and the API service is running, then retry.",
      { network: true, timeout: timeoutHit, cause: err },
    );
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
  if (res.status === 401) {
    setToken(null);
    throw new ApiError("Unauthorized. Sign in again.", { status: 401, code: "unauthorized" });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let friendly: string | null = null;
    let code: string | undefined;
    let details: unknown;
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string; details?: unknown };
      friendly = parsed.message ?? parsed.error ?? null;
      code = parsed.error;
      details = parsed.details;
    } catch {
    }
    throw new ApiError(friendly ?? `HTTP ${res.status}: ${body}`, {
      status: res.status,
      code,
      details,
    });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
