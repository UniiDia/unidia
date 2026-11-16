import { CommandHistory, MoveNodeCommand, SetCodeCommand, SetEdgePathCommand } from '../core/Command';
import { DiagramModel } from '../core/DiagramModel';
import { exportStrategies } from '../export/ExportStrategy';
import { ClassDiagramOverlay } from '../overlay/ClassDiagramOverlay';
import { RenderEngine } from '../render/RenderEngine';
import { type DiagramType, detectDiagramType } from '../render/diagramTypes';

const SAMPLE_CODE = `classDiagram
  class Animal {
    +String name
    +eat()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog
`;

const RENDER_DEBOUNCE_MS = 150;
const HISTORY_DEBOUNCE_MS = 400;

const HINTS: Record<DiagramType, string> = {
  class: '노드 드래그: 이동 · □ 핸들: 크기 조절 · 선 드래그: 꺾기 · 꺾임점 더블클릭: 삭제',
  sequence: '시퀀스 다이어그램은 아직 GUI 편집을 지원하지 않습니다',
};

/** UI 계층: 코드 에디터와 캔버스를 항상 함께 표시한다 (REQ-10). */
export class App {
  private model = new DiagramModel({ code: SAMPLE_CODE });
  private history = new CommandHistory();
  private engine = new RenderEngine();
  private overlay = new ClassDiagramOverlay({
    onLayoutCommit: (nodeId, layout) => {
      this.flushPendingInput();
      this.history.execute(new MoveNodeCommand(this.model, nodeId, layout));
      this.updateButtons();
    },
    onEdgePathCommit: (edgeKey, waypoints) => {
      this.flushPendingInput();
      this.history.execute(new SetEdgePathCommand(this.model, edgeKey, waypoints));
      this.updateButtons();
    },
  });

  private textarea!: HTMLTextAreaElement;
  private canvas!: HTMLDivElement;
  private status!: HTMLSpanElement;
  private hint!: HTMLSpanElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;

  private committedCode = SAMPLE_CODE;
  private lastSvg = '';
  private lastType: DiagramType | null = null;
  private renderToken = 0;
  private renderTimer: number | undefined;
  private historyTimer: number | undefined;

  constructor(private root: HTMLElement) {}

  mount(): void {
    this.root.innerHTML = `
      <div class="toolbar">
        <button data-action="undo">실행 취소 (Ctrl+Z)</button>
        <button data-action="redo">다시 실행 (Ctrl+Y)</button>
        <button data-action="export-mermaid">Mermaid 코드 내보내기</button>
        <span class="hint"></span>
        <span class="status"></span>
      </div>
      <div class="panes">
        <div class="code-pane"><textarea spellcheck="false"></textarea></div>
        <div class="canvas-pane"></div>
      </div>`;

    this.textarea = this.root.querySelector('textarea')!;
    this.canvas = this.root.querySelector('.canvas-pane')!;
    this.status = this.root.querySelector('.status')!;
    this.hint = this.root.querySelector('.hint')!;
    this.undoButton = this.root.querySelector('[data-action="undo"]')!;
    this.redoButton = this.root.querySelector('[data-action="redo"]')!;

    this.textarea.value = this.model.getState().code;

    // 모델 변경 → 에디터 반영 + 렌더링 (Observer)
    let renderedCode = this.model.getState().code;
    this.model.subscribe((state) => {
      if (this.textarea.value !== state.code) this.textarea.value = state.code;
      this.committedCode = state.code;
      if (state.code !== renderedCode) {
        renderedCode = state.code;
        this.scheduleRender();
      } else {
        // 위치·크기만 바뀐 경우: Mermaid를 다시 돌리지 않고 오버레이만 다시 적용한다.
        this.showDiagram();
      }
      this.updateButtons();
    });

    this.textarea.addEventListener('input', () => this.onCodeInput());
    this.undoButton.addEventListener('click', () => this.history.undo());
    this.redoButton.addEventListener('click', () => this.history.redo());
    this.root
      .querySelector('[data-action="export-mermaid"]')!
      .addEventListener('click', () => void this.exportAs('mermaid'));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.updateButtons();
    void this.renderNow();
  }

  private onCodeInput(): void {
    // 입력 중에는 미리보기만 갱신하고, 잠시 멈추면 한 번의 편집(Command)으로 기록한다.
    this.scheduleRender(this.textarea.value);
    window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => {
      const next = this.textarea.value;
      if (next === this.committedCode) return;
      const prev = this.committedCode;
      this.committedCode = next;
      this.history.execute(new SetCodeCommand(this.model, prev, next));
      this.updateButtons();
    }, HISTORY_DEBOUNCE_MS);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.flushPendingInput();
      this.history.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      this.history.redo();
    }
  }

  /** 아직 기록되지 않은 입력이 있으면 먼저 기록해서 Undo가 그 입력부터 되돌리게 한다. */
  private flushPendingInput(): void {
    window.clearTimeout(this.historyTimer);
    const next = this.textarea.value;
    if (next === this.committedCode) return;
    const prev = this.committedCode;
    this.committedCode = next;
    this.history.execute(new SetCodeCommand(this.model, prev, next));
  }

  private scheduleRender(code?: string): void {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => void this.renderNow(code), RENDER_DEBOUNCE_MS);
  }

  private async renderNow(code?: string): Promise<void> {
    const source = code ?? this.model.getState().code;
    const token = ++this.renderToken;
    const type = detectDiagramType(source);
    if (type === null) {
      this.showError('지원하지 않는 다이어그램입니다. classDiagram 또는 sequenceDiagram으로 시작해 주세요.');
      return;
    }
    const startedAt = performance.now();
    try {
      const { svg } = await this.engine.render(source);
      if (token !== this.renderToken) return; // 더 최신 렌더 요청이 있으면 버린다
      this.lastSvg = svg;
      this.lastType = type;
      this.showDiagram();
      this.status.textContent = `${type} · 렌더 ${Math.round(performance.now() - startedAt)}ms`;
    } catch (error) {
      if (token !== this.renderToken) return;
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /** 마지막으로 렌더링한 SVG를 캔버스에 놓고, 저장된 노드 위치·크기를 오버레이로 적용한다. */
  private showDiagram(): void {
    this.overlay.detach();
    if (!this.lastSvg) return;
    this.canvas.innerHTML = this.lastSvg;
    this.hint.textContent = this.lastType ? HINTS[this.lastType] : '';
    const svg = this.canvas.querySelector('svg');
    if (svg && this.lastType === 'class') {
      const { nodeLayouts, edgePaths } = this.model.getState();
      this.overlay.attach(svg, nodeLayouts, edgePaths);
    }
  }

  private showError(message: string): void {
    this.overlay.detach();
    this.lastSvg = '';
    this.hint.textContent = '';
    this.canvas.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'error';
    el.textContent = message;
    this.canvas.appendChild(el);
    this.status.textContent = '오류';
  }

  private updateButtons(): void {
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
  }

  private async exportAs(id: 'png' | 'jpg' | 'mermaid'): Promise<void> {
    const strategy = exportStrategies.find((s) => s.id === id);
    if (!strategy) return;
    try {
      const blob = await strategy.export({ svg: this.lastSvg, code: this.model.getState().code });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagram.${strategy.extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }
}
