import { getHaConfig } from "./client.js";

interface HaWsMessage {
  type: string;
  id?: number;
  success?: boolean;
  result?: unknown;
  error?: { message?: string };
}

function toWsUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/websocket";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export async function haCallWs<T>(commandType: string, timeoutMs = 12_000): Promise<T> {
  const cfg = getHaConfig();
  if (!cfg) throw new Error("Home Assistant not configured");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(toWsUrl(cfg.url));
    const commandId = 1;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        ws.close();
        reject(new Error("Home Assistant websocket timeout"));
      });
    }, timeoutMs);

    ws.addEventListener("error", () => {
      finish(() => reject(new Error("Home Assistant websocket connection failed")));
    });

    ws.addEventListener("message", (ev) => {
      let msg: HaWsMessage;
      try {
        msg = JSON.parse(String(ev.data)) as HaWsMessage;
      } catch {
        return;
      }

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
        return;
      }

      if (msg.type === "auth_invalid") {
        finish(() => {
          ws.close();
          reject(new Error("Home Assistant websocket auth failed"));
        });
        return;
      }

      if (msg.type === "auth_ok") {
        ws.send(JSON.stringify({ id: commandId, type: commandType }));
        return;
      }

      if (msg.type === "result" && msg.id === commandId) {
        finish(() => {
          ws.close();
          if (msg.success) resolve(msg.result as T);
          else reject(new Error(msg.error?.message ?? "Home Assistant websocket command failed"));
        });
      }
    });
  });
}

export async function haCallWsAll(commandTypes: string[], timeoutMs = 15_000): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const type of commandTypes) {
    results.push(await haCallWs(type, timeoutMs));
  }
  return results;
}
