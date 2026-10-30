import { ForgeSnapshotSchema, FightSchema, type ForgeSnapshot, type ForgeFight } from '../../engine/forge-protocol';

export class ForgeClient {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null;
  private stopped = false;
  constructor(private readonly onState: (state: ForgeSnapshot) => void, private readonly onConnection: (online: boolean) => void) { this.connect(); }
  private connect() {
    if (this.stopped) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); this.socket = socket;
    socket.addEventListener('open', () => { this.token = null; this.onConnection(true); });
    socket.addEventListener('message', (event) => {
      try { const parsed = ForgeSnapshotSchema.safeParse(JSON.parse(String(event.data))); if (parsed.success) this.onState(parsed.data); }
      catch { /* Malformed events never become executable UI content. */ }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => { this.onConnection(false); if (!this.stopped) this.timer = setTimeout(() => this.connect(), 2000); });
  }
  async post(path: string, body: unknown = {}): Promise<unknown> {
    if (!this.token) {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('The local forge is unavailable.');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') throw new Error('Invalid local control session.');
      this.token = data.token;
    }
    const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-token': this.token }, body: JSON.stringify(body) });
    const data: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 403) this.token = null;
      throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'The local action failed.');
    }
    return data;
  }
  async claim(): Promise<ForgeFight> { return FightSchema.parse(await this.post('claim')); }
  close() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.socket?.close(); }
}
