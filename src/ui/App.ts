import {
  type Command,
  CommandHistory,
  MoveNodeCommand,
  SetCodeCommand,
  SetEdgePathCommand,
} from '../core/Command';
import { DiagramModel } from '../core/DiagramModel';
import { exportStrategies } from '../export/ExportStrategy';
import { ClassDiagramOverlay } from '../overlay/ClassDiagramOverlay';
import type { OverlayCallbacks } from '../overlay/OverlayLayer';
import { SequenceDiagramOverlay } from '../overlay/SequenceDiagramOverlay';
import { moveMessage, reconnectMessage } from '../overlay/sequenceCode';
import { makeBenchmarkCode, runOverlayBenchmark, waitFor } from '../overlay/benchmark';
import type { DiagramType } from '../render/diagramTypes';
import { RenderEngine, type RenderResult } from '../render/RenderEngine';
import { RenderScheduler } from '../render/RenderScheduler';
import { SvgViewport } from '../render/SvgViewport';
import { serializeDiagram } from '../render/serializeDiagram';
import { parseEdgeKey, reconnectEdge } from '../overlay/reconnect';
import { BatchCommand } from './BatchCommand';

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

/** 주소 끝에 ?bench 를 붙이면 성능 측정 버튼이 나온다 (개발·검증용). */
const BENCHMARK_MODE = new URLSearchParams(location.search).has('bench');

const HINTS: Record<DiagramType, string> = {
  class: '노드 드래그: 이동 · □ 핸들: 크기 조절 · 선 드래그: 꺾기 · 꺾임점 더블클릭: 삭제 · 선 끝 ■ 드래그: 다시 연결',
  sequence: '참여자 드래그: 좌우 이동 · 메시지 드래그: 간격 조정, 다른 메시지를 넘어가면 순서 변경 · 메시지 끝 ■ 드래그: 보낸이·받는이 변경',
};

/** UI 계층: 코드 에디터와 캔버스를 항상 함께 표시한다 (REQ-10). */
export class App {
  private model = new DiagramModel({ code: SAMPLE_CODE });
  private history = new CommandHistory();
  private engine = new RenderEngine();
  /**
   * 오버레이 편집 (UniDia 가이드 "core 사용 규칙 1"):
   * 드래그 중에는 setNodeLayout/setEdgePath로 모델에 미리보기만 반영하고,
   * 드래그가 끝나면 시작 전 값을 { prev }로 넘겨 히스토리에 한 번만 기록한다.
   */
  private overlayCallbacks: OverlayCallbacks = {
    onLayoutPreview: (nodeId, layout) => this.preview(() => this.model.setNodeLayout(nodeId, layout)),
    onLayoutCommit: (nodeId, layout, prev) =>
      this.commitOverlayEdit(new MoveNodeCommand(this.model, nodeId, layout, { prev })),
    onEdgePathPreview: (edgeKey, points) => this.preview(() => this.model.setEdgePath(edgeKey, points)),
    onEdgePathCommit: (edgeKey, points, prev) =>
      this.commitOverlayEdit(new SetEdgePathCommand(this.model, edgeKey, points, { prev })),
  };
  /** 클래스 다이어그램 오버레이 (REQ-02·04·05, 엣지 다시 연결) */
  private overlay = new ClassDiagramOverlay({
    ...this.overlayCallbacks,
    onEdgeReconnect: (edgeKey, end, nodeId) => this.reconnectEdge(edgeKey, end, nodeId),
  });
  /** 시퀀스 다이어그램 오버레이 (참여자 좌우 이동, 메시지 간격 조정·순서 변경) */
  private sequenceOverlay = new SequenceDiagramOverlay({
    ...this.overlayCallbacks,
    onMessageReorder: (from, to, key) => this.reorderMessage(from, to, key),
    onMessageReconnect: (index, end, participant, key) => this.reconnectMessage(index, end, participant, key),
  });
  /** 드래그 미리보기 중에는 오버레이가 이미 화면을 그렸으므로 다시 그리지 않는다. */
  private previewing = false;
  private viewport = new SvgViewport();
  private scheduler = new RenderScheduler(this.engine, {
    onSuccess: (result, startedAt) => this.showRender(result, startedAt),
    onError: (error) => this.showError(error instanceof Error ? error.message : String(error)),
  }, RENDER_DEBOUNCE_MS);

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
  private requestedCode: string | undefined;
  private renderedCode: string | undefined;
  private historyTimer: number | undefined;

  constructor(private root: HTMLElement) {}

  mount(): void {
    this.root.innerHTML = `
      <div class="toolbar">
        <button data-action="undo">실행 취소 (Ctrl+Z)</button>
        <button data-action="redo">다시 실행 (Ctrl+Y)</button>
        <button data-action="export-mermaid">Mermaid 코드 내보내기</button>
        ${BENCHMARK_MODE ? '<button data-action="benchmark">성능 측정 (노드 30개)</button>' : ''}
        <span class="hint"></span>
        <label>배율
          <select aria-label="다이어그램 배율">
            <option value="0.25">25%</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1" selected>100%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
            <option value="3">300%</option>
            <option value="4">400%</option>
          </select>
        </label>
        <span class="status" role="status"></span>
      </div>
      <div class="panes">
        <div class="code-pane"><textarea aria-label="Mermaid 코드" spellcheck="false"></textarea></div>
        <div class="canvas-pane" aria-label="다이어그램 미리보기"></div>
      </div>`;

    this.textarea = this.root.querySelector('textarea')!;
    this.canvas = this.root.querySelector('.canvas-pane')!;
    this.status = this.root.querySelector('.status')!;
    this.hint = this.root.querySelector('.hint')!;
    this.undoButton = this.root.querySelector('[data-action="undo"]')!;
    this.redoButton = this.root.querySelector('[data-action="redo"]')!;

    this.textarea.value = this.model.getState().code;

    // 모델 변경 → 에디터 반영 + 렌더링 (Observer)
    let observedState = this.model.getState();
    this.model.subscribe((state) => {
      const visualsChanged = state.nodeLayouts !== observedState.nodeLayouts ||
        state.edgePaths !== observedState.edgePaths;
      observedState = state;
      if (this.previewing) return;
      if (this.textarea.value !== state.code) this.textarea.value = state.code;
      this.committedCode = state.code;
      if (state.code !== this.requestedCode) {
        this.scheduleRender();
      } else if (visualsChanged && state.code === this.renderedCode) {
        // 위치·크기만 바뀐 경우: Mermaid를 다시 돌리지 않고 오버레이만 다시 적용한다.
        // 코드 이력의 400ms 지연 기록은 진행 중인 드래그의 SVG를 교체하지 않는다.
        this.showDiagram();
      }
      this.updateButtons();
    });

    this.textarea.addEventListener('input', () => this.onCodeInput());
    this.undoButton.addEventListener('click', () => {
      this.flushPendingInput();
      this.history.undo();
      this.updateButtons();
    });
    this.redoButton.addEventListener('click', () => {
      this.flushPendingInput();
      this.history.redo();
      this.updateButtons();
    });
    this.root
      .querySelector('[data-action="export-mermaid"]')!
      .addEventListener('click', () => void this.exportAs('mermaid'));
    this.root.querySelector('select')!.addEventListener('change', (event) => {
      this.viewport.setZoom(Number((event.target as HTMLSelectElement).value));
    });
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root
      .querySelector('[data-action="benchmark"]')
      ?.addEventListener('click', () => void this.runBenchmark());

    this.updateButtons();
    this.scheduleRender(undefined, true);
  }

  private onCodeInput(): void {
    // 입력 중에는 미리보기만 갱신하고, 잠시 멈추면 한 번의 편집(Command)으로 기록한다.
    this.scheduleRender(this.textarea.value);
    this.updateButtons();
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
      this.updateButtons();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      this.flushPendingInput();
      this.history.redo();
      this.updateButtons();
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
    this.updateButtons();
  }

  private scheduleRender(code?: string, immediate = false): void {
    const source = code ?? this.model.getState().code;
    // Command 기록 시 같은 코드가 다시 통지되어도 중복 렌더하지 않는다.
    if (source === this.requestedCode) return;
    this.requestedCode = source;
    ++this.renderToken;
    // 새 코드가 준비될 때까지 이전 노드에 대한 편집을 받지 않는다.
    this.detachOverlays();
    this.canvas.setAttribute('aria-busy', 'true');
    this.status.dataset.state = 'pending';
    delete this.status.dataset.renderMs;
    this.status.textContent = '렌더링 중…';
    this.scheduler.request(source, immediate);
  }

  private showRender({ svg, type }: RenderResult, startedAt: number): void {
    this.lastSvg = svg;
    this.lastType = type;
    this.renderedCode = this.requestedCode;
    this.showDiagram();
    const token = this.renderToken;
    // 마지막 입력부터 debounce·렌더·화면 반영까지 포함한다 (REQ-01).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== this.renderToken) return;
      const elapsed = performance.now() - startedAt;
      this.canvas.setAttribute('aria-busy', 'false');
      this.status.dataset.state = 'success';
      this.status.dataset.renderMs = String(elapsed);
      this.status.textContent = `${type === 'class' ? '클래스' : '시퀀스'} · 반영 ${Math.round(elapsed)}ms`;
    }));
  }

  /** 마지막으로 렌더링한 SVG를 캔버스에 놓고, 저장된 노드 위치·크기를 오버레이로 적용한다. */
  private showDiagram(): void {
    this.detachOverlays();
    this.viewport.detach();
    if (!this.lastSvg) return;
    this.canvas.innerHTML = this.lastSvg;
    this.hint.textContent = this.lastType ? HINTS[this.lastType] : '';
    const svg = this.canvas.querySelector('svg');
    if (!svg || !this.lastType) return;
    const { nodeLayouts, edgePaths } = this.model.getState();
    const overlay = this.lastType === 'class' ? this.overlay : this.sequenceOverlay;
    overlay.attach(svg, nodeLayouts, edgePaths);
    this.viewport.attach(svg);
  }

  private detachOverlays(): void {
    this.overlay.detach();
    this.sequenceOverlay.detach();
  }

  private preview(apply: () => void): void {
    this.previewing = true;
    try {
      apply();
    } finally {
      this.previewing = false;
    }
  }

  /**
   * 선의 시작/끝을 다른 노드로 다시 연결: Mermaid 코드의 관계 줄에서 클래스 이름을 바꾸고
   * SetCodeCommand로 기록한다 (Ctrl+Z로 되돌릴 수 있음).
   */
  private reconnectEdge(edgeKey: string, end: 'start' | 'end', nodeId: string): void {
    this.flushPendingInput();
    const prev = this.model.getState().code;
    const ref = parseEdgeKey(edgeKey);
    const next = ref ? reconnectEdge(prev, ref, end, nodeId) : null;
    if (!next || next === prev) {
      this.status.textContent = '코드에서 이 연결선의 관계 줄을 찾지 못했습니다';
      return;
    }
    this.history.execute(new SetCodeCommand(this.model, prev, next));
    this.updateButtons();
  }

  /** 시퀀스 메시지 순서 변경: 코드의 메시지 줄을 옮긴다. */
  private reorderMessage(from: number, to: number, key: string | null): void {
    this.flushPendingInput();
    const code = this.model.getState().code;
    this.applySequenceCodeEdit(moveMessage(code, from, to), key, '코드에서 메시지 줄을 찾지 못해 순서를 바꾸지 못했습니다');
  }

  /** 시퀀스 메시지 보낸이·받는이 변경: 코드의 메시지 줄에서 참여자 이름을 바꾼다. */
  private reconnectMessage(index: number, end: 'start' | 'end', participant: string, key: string | null): void {
    this.flushPendingInput();
    const code = this.model.getState().code;
    this.applySequenceCodeEdit(
      reconnectMessage(code, index, end, participant),
      key,
      '코드에서 메시지 줄을 찾지 못해 보낸이·받는이를 바꾸지 못했습니다',
    );
  }

  /**
   * 시퀀스 메시지를 코드에서 바꾼 결과를 기록한다. 그 메시지에 저장된 간격 조정은 새 자리에서 의미가 없으므로
   * 함께 지우고, 둘을 묶어 실행 취소 한 번에 되돌린다.
   */
  private applySequenceCodeEdit(next: string | null, key: string | null, failMessage: string): void {
    const prev = this.model.getState().code;
    if (!next || next === prev) {
      this.status.textContent = failMessage;
      return;
    }
    const commands: Command[] = [new SetCodeCommand(this.model, prev, next)];
    if (key && this.model.getState().edgePaths[key]) {
      commands.push(new SetEdgePathCommand(this.model, key, undefined));
    }
    this.history.execute(commands.length === 1 ? commands[0] : new BatchCommand(commands));
    this.updateButtons();
  }

  private commitOverlayEdit(command: Command): void {
    this.flushPendingInput();
    this.history.execute(command);
    this.updateButtons();
    // 미리보기로 모델이 이미 같은 값이면 알림이 오지 않으므로, 여기서 한 번 다시 그린다 (보이는 영역 맞추기 포함).
    if (this.renderedCode === this.requestedCode) this.showDiagram();
  }

  /**
   * 성능·정확도 측정 (SRS 3.3, REQ-04 확인 기준): 노드 30개 다이어그램에서 노드를 무작위로 20번 끌며
   * 프레임 속도와 엣지 끝점 오차를 잰다. 측정으로 옮긴 위치는 모델에 기록하지 않고 끝나면 원래대로 돌린다.
   */
  private async runBenchmark(): Promise<void> {
    this.flushPendingInput();
    const code = makeBenchmarkCode(30);
    if (this.model.getState().code !== code) {
      this.history.execute(new SetCodeCommand(this.model, this.committedCode, code));
      this.updateButtons();
    }
    this.status.textContent = '측정 준비 중…';
    const ready = await waitFor(() => this.renderedCode === code &&
      this.status.dataset.state === 'success' && this.overlay.nodeIds().length >= 30);
    if (!ready) {
      this.status.textContent = '측정 실패: 다이어그램이 그려지지 않았습니다';
      return;
    }
    this.status.textContent = '측정 중… (끝날 때까지 이 탭을 보고 있어 주세요)';
    const result = await runOverlayBenchmark(this.overlay);
    this.showDiagram(); // 측정하느라 옮긴 노드를 원래 자리로
    console.table(result);
    (window as unknown as { unidiaBenchmark?: unknown }).unidiaBenchmark = result;
    const verdict = result.passFps && result.passEndpoint ? '기준 통과' : '기준 미달';
    this.status.textContent =
      `노드 ${result.nodes}개 · 평균 ${result.avgFps}fps (최저 ${result.minFps}) · ` +
      `끝점 오차 최대 ${result.maxEndpointErrorPx}px · ${verdict}` +
      (result.pageVisible ? '' : ' (탭이 가려져 fps 무효)');
  }

  private showError(message: string): void {
    this.detachOverlays();
    this.viewport.detach();
    this.lastSvg = '';
    this.lastType = null;
    this.renderedCode = undefined;
    this.hint.textContent = '';
    this.canvas.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'error';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    this.canvas.appendChild(el);
    this.status.textContent = '오류';
    this.status.dataset.state = 'error';
    this.canvas.setAttribute('aria-busy', 'false');
  }

  private updateButtons(): void {
    const pendingInput = this.textarea.value !== this.committedCode;
    this.undoButton.disabled = !pendingInput && !this.history.canUndo;
    this.redoButton.disabled = pendingInput || !this.history.canRedo;
  }

  private async exportAs(id: 'png' | 'jpg' | 'mermaid'): Promise<void> {
    const strategy = exportStrategies.find((s) => s.id === id);
    if (!strategy) return;
    try {
      this.flushPendingInput();
      const svg = this.canvas.querySelector('svg');
      if (id !== 'mermaid' && (!svg || this.status.dataset.state !== 'success')) {
        throw new Error('다이어그램 렌더링이 완료된 뒤 내보내 주세요.');
      }
      const blob = await strategy.export({
        svg: svg ? serializeDiagram(svg) : '',
        code: this.model.getState().code,
      });
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
