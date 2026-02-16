import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { gatewayRequest, isGatewayAvailable } from "../gateway-client";

let server: WebSocketServer;
let port: number;

function startServer(handler: (ws: WsWebSocket, data: string) => void): Promise<void> {
  return new Promise((resolve) => {
    server = new WebSocketServer({ port: 0 });
    server.on("listening", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
    server.on("connection", (ws) => {
      ws.on("message", (data) => handler(ws, String(data)));
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

describe("gatewayRequest", () => {
  afterEach(async () => {
    await stopServer();
  });

  it("sends request and receives successful response", async () => {
    await startServer((ws, data) => {
      const msg = JSON.parse(data);
      ws.send(
        JSON.stringify({
          type: "res",
          id: msg.id,
          ok: true,
          payload: { totalCost: 1.5 },
        }),
      );
    });

    const result = await gatewayRequest<{ totalCost: number }>(
      "usage.cost",
      { days: 30 },
      { url: `ws://localhost:${port}` },
    );

    expect(result).toEqual({ totalCost: 1.5 });
  });

  it("rejects on error response", async () => {
    await startServer((ws, data) => {
      const msg = JSON.parse(data);
      ws.send(
        JSON.stringify({
          type: "res",
          id: msg.id,
          ok: false,
          error: { message: "Not found", code: "NOT_FOUND" },
        }),
      );
    });

    await expect(
      gatewayRequest("usage.cost", undefined, {
        url: `ws://localhost:${port}`,
      }),
    ).rejects.toThrow("Not found");
  });

  it("rejects on timeout", async () => {
    await startServer(() => {
      // Never respond
    });

    await expect(
      gatewayRequest("usage.cost", undefined, {
        url: `ws://localhost:${port}`,
        timeoutMs: 100,
      }),
    ).rejects.toThrow("timed out");
  });

  it("rejects when gateway URL is not configured", async () => {
    await expect(
      gatewayRequest("usage.cost", undefined, {
        url: "",
      }),
    ).rejects.toThrow("OPENCLAW_GATEWAY_URL not configured");
  });

  it("rejects on connection error", async () => {
    await expect(
      gatewayRequest("usage.cost", undefined, {
        url: "ws://localhost:1",
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/connection failed|ECONNREFUSED/i);
  });

  it("passes auth token in headers", async () => {
    let receivedHeaders: Record<string, string> = {};

    await startServer((ws, data) => {
      const msg = JSON.parse(data);
      ws.send(
        JSON.stringify({
          type: "res",
          id: msg.id,
          ok: true,
          payload: {},
        }),
      );
    });

    // Override the server to capture headers
    await stopServer();
    await new Promise<void>((resolve) => {
      server = new WebSocketServer({ port: 0 });
      server.on("listening", () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
      server.on("connection", (ws, req) => {
        receivedHeaders = req.headers as Record<string, string>;
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data));
          ws.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: true,
              payload: {},
            }),
          );
        });
      });
    });

    await gatewayRequest("usage.cost", undefined, {
      url: `ws://localhost:${port}`,
      token: "test-token-123",
    });

    expect(receivedHeaders.authorization).toBe("Bearer test-token-123");
  });

  it("ignores messages with non-matching id", async () => {
    await startServer((ws, data) => {
      const msg = JSON.parse(data);
      // Send a response with wrong id first
      ws.send(
        JSON.stringify({
          type: "res",
          id: "wrong-id",
          ok: true,
          payload: { wrong: true },
        }),
      );
      // Then the correct one
      ws.send(
        JSON.stringify({
          type: "res",
          id: msg.id,
          ok: true,
          payload: { correct: true },
        }),
      );
    });

    const result = await gatewayRequest<{ correct: boolean }>(
      "usage.cost",
      undefined,
      { url: `ws://localhost:${port}` },
    );

    expect(result).toEqual({ correct: true });
  });
});

describe("isGatewayAvailable", () => {
  afterEach(async () => {
    await stopServer();
  });

  it("returns true when gateway responds", async () => {
    await startServer((ws, data) => {
      const msg = JSON.parse(data);
      ws.send(
        JSON.stringify({
          type: "res",
          id: msg.id,
          ok: true,
          payload: {},
        }),
      );
    });

    const available = await isGatewayAvailable({
      url: `ws://localhost:${port}`,
    });
    expect(available).toBe(true);
  });

  it("returns false when gateway is unreachable", async () => {
    const available = await isGatewayAvailable({
      url: "ws://localhost:1",
      timeoutMs: 500,
    });
    expect(available).toBe(false);
  });
});
