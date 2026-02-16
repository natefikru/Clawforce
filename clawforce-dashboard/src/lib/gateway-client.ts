/**
 * Thin WebSocket JSON-RPC client for the OpenClaw gateway.
 *
 * Uses the same frame protocol as OpenClaw's gateway client:
 * - Request:  { type: "req", id, method, params }
 * - Response: { type: "res", id, ok, payload?, error? }
 */
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 10_000;

export type GatewayClientOptions = {
  url?: string;
  token?: string;
  timeoutMs?: number;
};

export type GatewayAvailabilityOptions = Partial<GatewayClientOptions>;

export type GatewayResponse<T = unknown> = {
  ok: boolean;
  payload?: T;
  error?: { message?: string; code?: string };
};

export async function gatewayRequest<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  options?: GatewayClientOptions,
): Promise<T> {
  const url = options?.url ?? process.env.OPENCLAW_GATEWAY_URL;
  const token = options?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!url) {
    throw new Error("OPENCLAW_GATEWAY_URL not configured");
  }

  return new Promise<T>((resolve, reject) => {
    const id = randomUUID();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Gateway request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const headers: Record<string, string> = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const ws = new WebSocket(url, { headers });

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(String(data)) as GatewayResponse<T> & {
          type: string;
          id: string;
        };
        if (msg.id !== id) return;

        settled = true;
        clearTimeout(timer);
        ws.close();

        if (msg.ok && msg.payload !== undefined) {
          resolve(msg.payload);
        } else {
          reject(
            new Error(
              msg.error?.message ?? "Gateway request failed",
            ),
          );
        }
      } catch {
        // Skip non-JSON messages
      }
    });

    ws.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Gateway connection failed: ${err.message}`));
      }
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Gateway connection closed unexpectedly"));
      }
    });
  });
}

/**
 * Check if the gateway is reachable.
 */
export async function isGatewayAvailable(
  options?: GatewayAvailabilityOptions,
): Promise<boolean> {
  try {
    await gatewayRequest("usage.status", undefined, {
      ...options,
      timeoutMs: 3000,
    });
    return true;
  } catch {
    return false;
  }
}
