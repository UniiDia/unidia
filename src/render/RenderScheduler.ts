import type { RenderResult } from './RenderEngine';

export interface Renderer {
  render(code: string): Promise<RenderResult>;
}

interface RenderRequest {
  version: number;
  code: string;
  startedAt: number;
  readyAt: number;
}

export interface RenderCallbacks {
  onSuccess(result: RenderResult, startedAt: number): void;
  onError(error: unknown): void;
}

/** REQ-01: 입력을 합치고, 실행 중인 작업 뒤에는 최신 요청 하나만 남긴다. */
export class RenderScheduler {
  private version = 0;
  private pending?: RenderRequest;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private disposed = false;

  constructor(
    private renderer: Renderer,
    private callbacks: RenderCallbacks,
    private debounceMs = 150,
  ) {}

  request(code: string, immediate = false): void {
    if (this.disposed) return;
    const startedAt = performance.now();
    // 새 렌더가 시작될 때가 아니라 입력 즉시 이전 결과를 무효화한다.
    this.pending = {
      version: ++this.version,
      code,
      startedAt,
      readyAt: startedAt + (immediate ? 0 : this.debounceMs),
    };
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    ++this.version;
    this.pending = undefined;
    clearTimeout(this.timer);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.pending || this.running) return;
    const delay = this.pending.readyAt - performance.now();
    if (delay <= 0) void this.flush();
    else this.timer = setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    if (this.running || !this.pending || this.disposed) return;
    const request = this.pending;
    this.pending = undefined;
    this.running = true;
    try {
      const result = await this.renderer.render(request.code);
      if (request.version === this.version) {
        this.callbacks.onSuccess(result, request.startedAt);
      }
    } catch (error) {
      if (request.version === this.version) this.callbacks.onError(error);
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
