import type { ApprovalRequest, GatewayCronEvent } from "@homebot/shared";

type EventHandler = (payload: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private token: string;
  private url: string;
  private reqId = 0;
  private pending = new Map<string, PendingRequest>();
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private challengeNonce: string | null = null;
  private connectSent = false;

  constructor(url?: string, token?: string) {
    this.url = url ?? this.defaultUrl();
    this.token = token ?? this.defaultToken();
  }

  private defaultUrl(): string {
    const port = 18789;
    const host = location.hostname || "127.0.0.1";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${host}:${port}`;
  }

  private defaultToken(): string {
    const hash = location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const fromHash = params.get("token");
    if (fromHash) return fromHash;
    return sessionStorage.getItem("homebot.gateway.token") ?? "";
  }

  get isConnected(): boolean {
    return this.connected;
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(this.url);
    this.connectSent = false;
    const tryConnect = () => {
      if (this.connectSent) return;
      this.connectSent = true;
      this.sendConnect();
    };

    this.ws.addEventListener("open", () => {
      this.connected = false;
      setTimeout(() => tryConnect(), 1500);
    });
    this.ws.addEventListener("message", (ev) => this.onMessage(String(ev.data)));
    this.ws.addEventListener("close", () => {
      this.connected = false;
      this.emit("connection", { connected: false });
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      this.connected = false;
      this.emit("connection", { connected: false });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private onMessage(raw: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (frame.type === "event") {
      const event = String(frame.event ?? "");
      const payload = frame.payload;
      if (event === "connect.challenge") {
        const p = payload as { nonce?: string };
        this.challengeNonce = p.nonce ?? null;
        this.connectSent = true;
        this.sendConnect();
        return;
      }
      this.emit(event, payload);
      if (event === "health" || event === "tick") {
        this.emit("connection", { connected: true });
      }
      return;
    }

    if (frame.type === "res") {
      const id = String(frame.id ?? "");
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (frame.ok) {
        if ((frame.payload as { type?: string })?.type === "hello-ok") {
          this.connected = true;
          this.emit("connection", { connected: true });
          if (this.token) sessionStorage.setItem("homebot.gateway.token", this.token);
        }
        pending.resolve(frame.payload);
      } else {
        pending.reject(new Error(String((frame.error as { message?: string })?.message ?? "RPC failed")));
      }
    }
  }

  private sendConnect(): void {
    const id = this.nextId();
    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: "homebot-dashboard",
        version: "1.0.0",
        platform: "linux",
        mode: "operator",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.approvals"],
      caps: [],
      commands: [],
      permissions: {},
      locale: "en-US",
      userAgent: "homebot-dashboard/1.0.0",
    };

    if (this.token) {
      params.auth = { token: this.token };
    }

    this.request("connect", params, id).catch(() => {
      this.connected = false;
      this.emit("connection", { connected: false });
    });
  }

  private nextId(): string {
    return `homebot-${++this.reqId}`;
  }

  request(method: string, params: Record<string, unknown> = {}, id?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }
      const reqId = id ?? this.nextId();
      this.pending.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ type: "req", id: reqId, method, params }));
      setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error("Request timeout"));
        }
      }, 15000);
    });
  }

  async listTasks(): Promise<unknown> {
    return this.request("tasks.list", {});
  }

  async resolveExecApproval(requestId: string, approved: boolean): Promise<unknown> {
    return this.request("exec.approval.resolve", { requestId, approved });
  }

  async resolvePluginApproval(requestId: string, approved: boolean): Promise<unknown> {
    return this.request("plugin.approval.resolve", { requestId, approved });
  }

  parseCronEvent(payload: unknown): GatewayCronEvent {
    const p = payload as Record<string, unknown>;
    return {
      id: String(p.id ?? p.jobId ?? ""),
      jobId: String(p.jobId ?? p.id ?? ""),
      name: String(p.name ?? p.jobId ?? "Cron job"),
      status: String(p.status ?? "unknown"),
      message: p.message ? String(p.message) : p.text ? String(p.text) : undefined,
      startedAt: typeof p.startedAt === "number" ? p.startedAt : undefined,
      finishedAt: typeof p.finishedAt === "number" ? p.finishedAt : undefined,
    };
  }

  parseApproval(event: string, payload: unknown): ApprovalRequest {
    const p = payload as Record<string, unknown>;
    const requestId = String(p.requestId ?? p.id ?? "");
    const command = String(p.command ?? p.summary ?? p.title ?? "Approval required");
    const detail = String(p.detail ?? p.description ?? p.rawCommand ?? command);
    return {
      requestId,
      kind: event === "plugin.approval.requested" ? "plugin" : "exec",
      title: command,
      detail,
      requestedAt: typeof p.requestedAt === "number" ? p.requestedAt : Date.now(),
    };
  }
}

export const gateway = new GatewayClient();
