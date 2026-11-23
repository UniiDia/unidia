import type { NodeLayout, Point } from '../core/DiagramModel';
import type { OverlayCallbacks, OverlayLayer } from './OverlayLayer';
import {
  assignMessageKeys,
  clamp,
  insertionIndex,
  messageRange,
  nearestById,
  noteOwner,
  parseTranslate,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ACCENT = '#1a73e8';
/* 가는 메시지 선도 잡기 쉽도록 클릭 판정 폭(화면 px)을 넓힌다 */
const MESSAGE_HIT_WIDTH = 12;
/* 메시지끼리 최소 간격 (순서가 뒤집히지 않게) */
const MIN_MESSAGE_GAP = 12;
/* 메시지 끝이 생명선에서 이 거리 안에 있어야 그 참여자의 메시지로 본다 */
const LIFELINE_SNAP_DISTANCE = 30;
const FIT_PADDING = 16;
/* 이 거리(px) 미만으로 움직이면 클릭으로 보고 편집으로 기록하지 않는다 */
const DRAG_THRESHOLD = 2;
/* 순서를 바꿀 때 놓일 자리 표시선 */
const REORDER_COLOR = '#1e8e3e';
const INDICATOR_OVERHANG = 60;
const ENDPOINT_SIZE = 8;
/* 메시지 끝을 놓을 때, 생명선에서 이 거리 안이면 그 참여자로 본다 */
const LIFELINE_PICK_DISTANCE = 90;

/*
 * 모델에 저장할 때 붙이는 접두어. 클래스 다이어그램의 노드 이름과 섞이지 않게 한다.
 *   참여자 위치: nodeLayouts["seq:Alice"] = { x: 생명선 x, y: 0 }
 *   메시지 간격: edgePaths["seq:Alice->Bob#0"] = [{ x: 0, y: 위아래 이동량 }]
 */
export const SEQUENCE_KEY_PREFIX = 'seq:';

interface Movable {
  el: SVGGraphicsElement;
  original: string | null;
}

interface Participant {
  id: string;
  /* Mermaid가 그린 생명선 x */
  baseX: number;
  /* 지금 생명선 x */
  x: number;
  custom: boolean;
  lifeline: SVGLineElement;
  /* 위·아래 상자 */
  boxes: Movable[];
  /* 참여자를 따라 움직이는 노트·활성 상자 */
  followers: Movable[];
}

interface Message {
  key: string | null;
  el: SVGLineElement | SVGPathElement;
  /* 메시지 글자 (여러 줄이면 여러 개) */
  texts: Movable[];
  from: string | null;
  to: string | null;
  /* 자기 자신에게 보내는 메시지 (Mermaid가 곡선 path로 그림) */
  self: boolean;
  /* 직선 메시지의 원래 좌표 */
  x1: number;
  x2: number;
  /* 원래 세로 위치 (직선은 y, 곡선은 위쪽 끝) */
  y: number;
  /* 자기 자신에게 보내는 곡선의 높이 (직선은 0) */
  height: number;
  original: string | null;
  /* 사용자가 위아래로 옮긴 양 */
  dy: number;
  hit: SVGLineElement | SVGPathElement | null;
}

type Selection = { kind: 'participant'; id: string } | { kind: 'message'; key: string } | null;

export interface SequenceDiagramOverlayOptions extends OverlayCallbacks {
  /*
   * 메시지를 끌어 다른 메시지를 넘어간 자리에 놓았을 때 (순서 변경).
   * from·to는 메시지끼리 센 순서(0부터). 코드의 메시지 줄을 옮기는 일은 호출한 쪽에서 한다.
   */
  onMessageReorder(from: number, to: number, key: string | null): void;
  /* 메시지 끝 ■ 핸들을 다른 참여자에 놓았을 때 (보낸이=start, 받는이=end 변경). 코드 수정은 호출한 쪽에서 한다. */
  onMessageReconnect(index: number, end: 'start' | 'end', participant: string, key: string | null): void;
}

/*
 * 시퀀스 다이어그램용 오버레이. 시퀀스에서는 위→아래 순서가 곧 시간 순서라 클래스 다이어그램처럼
 * 자유롭게 옮기지 않고, 시퀀스에 맞는 두 가지 움직임만 제공한다.
 * - 참여자 좌우 이동 (REQ-02): 위·아래 상자를 끌면 생명선과 함께 옆으로 움직인다.
 *   연결된 메시지 화살표는 양 끝이 생명선에 붙은 채 늘어나거나 줄어든다 (REQ-04). 노트·활성 상자도 따라간다.
 * - 메시지 간격 조정: 메시지 화살표를 위아래로 끈다. 바로 위·아래 메시지 사이에 놓으면 간격만 바뀐다.
 * - 메시지 순서 변경: 다른 메시지를 넘어가면 놓일 자리에 표시선이 보이고, 놓으면 코드의 메시지 줄 순서가 바뀐다.
 * - 보낸이·받는이 변경: 메시지를 선택하면 양 끝에 ■ 핸들이 생기고, 다른 참여자 생명선에 놓으면 코드가 바뀐다.
 * 결과는 클래스 다이어그램과 같은 방식으로 콜백에 넘긴다 (미리보기 → { prev }로 한 번 기록).
 */
export class SequenceDiagramOverlay implements OverlayLayer {
  private svg: SVGSVGElement | null = null;
  private participants = new Map<string, Participant>();
  private messages: Message[] = [];
  private hitGroup: SVGGElement | null = null;
  private overlayGroup: SVGGElement | null = null;
  private selectionBox: SVGRectElement | null = null;
  /* 메시지 순서를 바꿀 때 놓일 자리를 보여주는 선 */
  private indicator: SVGLineElement | null = null;
  /* 선택한 메시지 양 끝의 ■ 핸들 (보낸이·받는이 변경) */
  private endpointGroup: SVGGElement | null = null;
  /* 보낸이·받는이를 바꾸는 중에 그리는 점선과 대상 생명선 강조 */
  private reconnectGroup: SVGGElement | null = null;
  /* 메시지가 올라갈 수 있는 가장 위 / 내려갈 수 있는 가장 아래 */
  private top = 0;
  private bottom = 0;
  /* 다시 그려져도 선택을 유지하기 위해 detach 때 지우지 않는다 */
  private selection: Selection = null;
  private savedLayouts: Record<string, NodeLayout> = {};
  private savedPaths: Record<string, Point[]> = {};
  private cleanups: (() => void)[] = [];
  private frame = 0;

  constructor(private options: SequenceDiagramOverlayOptions) {}

  attach(
    svg: SVGSVGElement,
    layouts: Record<string, NodeLayout> = {},
    edgePaths: Record<string, Point[]> = {},
  ): void {
    this.detach();
    this.svg = svg;
    this.savedLayouts = layouts;
    this.savedPaths = edgePaths;
    svg.classList.add('unidia-editable');
    svg.style.overflow = 'visible';

    this.collectParticipants(svg);
    if (this.participants.size === 0) return;
    this.collectMessages(svg);
    this.createHitAreas(svg);
    this.createSelectionLayer(svg);

    let changed = false;
    for (const participant of this.participants.values()) {
      const saved = layouts[SEQUENCE_KEY_PREFIX + participant.id];
      if (!saved) continue;
      participant.x = saved.x;
      participant.custom = true;
      changed = true;
    }
    for (const message of this.messages) {
      const saved = message.key ? edgePaths[message.key] : undefined;
      if (saved && saved.length > 0) {
        message.dy = saved[0].y;
        changed = true;
      }
    }
    if (changed) {
      for (const participant of this.participants.values()) this.applyParticipant(participant);
      for (const message of this.messages) this.applyMessage(message);
      this.fitViewBox();
    }

    if (!this.selectionExists()) this.selection = null;
    this.updateSelection();

    const onPointerDown = (e: PointerEvent) => this.onPointerDown(e);
    svg.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() => svg.removeEventListener('pointerdown', onPointerDown));
  }

  detach(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.hitGroup?.remove();
    this.overlayGroup?.remove();
    this.hitGroup = this.overlayGroup = this.selectionBox = this.indicator = null;
    this.endpointGroup = this.reconnectGroup = null;
    this.svg = null;
    this.participants.clear();
    this.messages = [];
  }

  // ── SVG 분석 ──────────────────────────────────────────────

  private collectParticipants(svg: SVGSVGElement): void {
    for (const lifeline of svg.querySelectorAll<SVGLineElement>('line[data-et="life-line"]')) {
      const id = lifeline.dataset.id;
      if (!id) continue;
      const x = Number(lifeline.getAttribute('x1'));
      this.participants.set(id, { id, baseX: x, x, custom: false, lifeline, boxes: [], followers: [] });
      this.bottom = Math.max(this.bottom, Number(lifeline.getAttribute('y2')));
    }

    // 위쪽 상자 (participant / actor)
    for (const el of svg.querySelectorAll<SVGGElement>('g[data-et="participant"]')) {
      const participant = el.dataset.id ? this.participants.get(el.dataset.id) : undefined;
      if (!participant) continue;
      this.addBox(participant, el);
      const box = el.getBBox();
      this.top = Math.max(this.top, box.y + box.height);
    }
    // 아래쪽 상자: participant는 rect.actor-bottom을 감싼 g, actor는 g.actor-bottom
    for (const el of svg.querySelectorAll<SVGGraphicsElement>('.actor-bottom[name]')) {
      const participant = this.participants.get(el.getAttribute('name') ?? '');
      if (!participant) continue;
      const box = el instanceof SVGRectElement && el.parentElement instanceof SVGGElement ? el.parentElement : el;
      this.addBox(participant, box);
    }

    // 노트·활성 상자는 가장 가까운 참여자를 따라간다
    const lifelines = [...this.participants.values()].map((p) => ({ id: p.id, x: p.baseX }));
    for (const el of svg.querySelectorAll<SVGGElement>('g[data-et="note"]')) {
      const rect = el.querySelector('rect');
      if (!rect) continue;
      const owner = noteOwner(rect.getBBox(), lifelines);
      if (owner) this.participants.get(owner)!.followers.push(movable(el));
    }
    for (const el of svg.querySelectorAll<SVGRectElement>('rect[class^="activation"]')) {
      const box = el.getBBox();
      const owner = nearestById(
        box.x + box.width / 2,
        lifelines.map(({ id, x }) => ({ id, value: x })),
        LIFELINE_SNAP_DISTANCE,
      );
      if (owner) this.participants.get(owner)!.followers.push(movable(el));
    }
  }

  private addBox(participant: Participant, el: SVGGraphicsElement): void {
    el.dataset.unidiaParticipant = participant.id;
    participant.boxes.push(movable(el));
  }

  private collectMessages(svg: SVGSVGElement): void {
    const lifelines = [...this.participants.values()].map((p) => ({ id: p.id, value: p.baseX }));
    const found: Omit<Message, 'key'>[] = [];
    for (const el of svg.querySelectorAll<SVGLineElement | SVGPathElement>('[data-et="message"]')) {
      const texts: Movable[] = [];
      for (let prev = el.previousElementSibling; prev?.classList.contains('messageText'); prev = prev.previousElementSibling) {
        texts.push(movable(prev as SVGGraphicsElement));
      }
      const base = { texts, original: el.getAttribute('transform'), dy: 0, hit: null };

      if (el instanceof SVGLineElement) {
        const x1 = Number(el.getAttribute('x1'));
        const x2 = Number(el.getAttribute('x2'));
        found.push({
          ...base,
          el,
          from: nearestById(x1, lifelines, LIFELINE_SNAP_DISTANCE),
          to: nearestById(x2, lifelines, LIFELINE_SNAP_DISTANCE),
          self: false,
          x1,
          x2,
          y: Number(el.getAttribute('y1')),
          height: 0,
        });
      } else {
        const box = el.getBBox();
        const owner = nearestById(box.x, lifelines, LIFELINE_SNAP_DISTANCE);
        found.push({
          ...base,
          el,
          from: owner,
          to: owner,
          self: true,
          x1: box.x,
          x2: box.x,
          y: box.y,
          height: box.height,
        });
      }
    }
    const keys = assignMessageKeys(found);
    this.messages = found.map((message, i) => ({
      ...message,
      key: keys[i] ? SEQUENCE_KEY_PREFIX + keys[i] : null,
    }));
  }

  /* 편집 가능한 메시지마다 투명한 굵은 선을 깔아 클릭하기 쉽게 한다. */
  private createHitAreas(svg: SVGSVGElement): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('unidia-message-hits');
    for (const message of this.messages) {
      if (!message.key) continue;
      const hit = message.el.cloneNode(false) as SVGLineElement | SVGPathElement;
      for (const name of ['id', 'class', 'style', 'marker-end', 'marker-start', 'data-id', 'data-et']) {
        hit.removeAttribute(name);
      }
      hit.classList.add('unidia-message-hit');
      hit.dataset.unidiaMessage = message.key;
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', String(MESSAGE_HIT_WIDTH));
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      hit.setAttribute('pointer-events', 'stroke');
      group.appendChild(hit);
      message.hit = hit;
    }
    svg.appendChild(group);
    this.hitGroup = group;
  }

  private createSelectionLayer(svg: SVGSVGElement): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('unidia-overlay');
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', ACCENT);
    box.setAttribute('stroke-width', '1.5');
    box.setAttribute('stroke-dasharray', '4 3');
    box.setAttribute('vector-effect', 'non-scaling-stroke');
    box.setAttribute('pointer-events', 'none');
    const indicator = document.createElementNS(SVG_NS, 'line');
    indicator.setAttribute('stroke', REORDER_COLOR);
    indicator.setAttribute('stroke-width', '2');
    indicator.setAttribute('stroke-dasharray', '6 4');
    indicator.setAttribute('vector-effect', 'non-scaling-stroke');
    indicator.setAttribute('pointer-events', 'none');
    indicator.setAttribute('display', 'none');
    const endpoints = document.createElementNS(SVG_NS, 'g');
    endpoints.classList.add('unidia-endpoints');
    const reconnect = document.createElementNS(SVG_NS, 'g');
    reconnect.setAttribute('pointer-events', 'none');
    group.append(box, indicator, endpoints, reconnect);
    svg.appendChild(group);
    this.overlayGroup = group;
    this.selectionBox = box;
    this.indicator = indicator;
    this.endpointGroup = endpoints;
    this.reconnectGroup = reconnect;
  }

  // ── 그리기 ────────────────────────────────────────────────

  private applyParticipant(participant: Participant): void {
    const dx = participant.x - participant.baseX;
    participant.lifeline.setAttribute('x1', String(participant.x));
    participant.lifeline.setAttribute('x2', String(participant.x));
    for (const item of [...participant.boxes, ...participant.followers]) shift(item, dx, 0);
  }

  private applyMessage(message: Message): void {
    const from = message.from ? this.participants.get(message.from) : undefined;
    const to = message.to ? this.participants.get(message.to) : undefined;
    const dxFrom = from ? from.x - from.baseX : 0;
    const dxTo = to ? to.x - to.baseX : 0;

    if (message.el instanceof SVGLineElement) {
      const x1 = message.x1 + dxFrom;
      const x2 = message.x2 + dxTo;
      const y = message.y + message.dy;
      for (const line of [message.el, message.hit]) {
        if (!(line instanceof SVGLineElement)) continue;
        line.setAttribute('x1', String(x1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y1', String(y));
        line.setAttribute('y2', String(y));
      }
      // 글자는 화살표 가운데에 오도록 양 끝 이동량의 평균만큼 옮긴다
      for (const text of message.texts) shift(text, (dxFrom + dxTo) / 2, message.dy);
    } else {
      // 자기 자신에게 보내는 메시지: 곡선 통째로 옮긴다
      for (const path of [message.el, message.hit]) {
        if (path) setTransform(path, join(message.original, translate(dxFrom, message.dy)));
      }
      for (const text of message.texts) shift(text, dxFrom, message.dy);
    }
  }

  private messagesOf(id: string): Message[] {
    return this.messages.filter((message) => message.from === id || message.to === id);
  }

  private selectionExists(): boolean {
    const selection = this.selection;
    if (!selection) return false;
    if (selection.kind === 'participant') return this.participants.has(selection.id);
    return this.messages.some((message) => message.key === selection.key);
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.updateSelection();
  }

  private updateSelection(): void {
    if (!this.selectionBox) return;
    const selection = this.selection;
    const participant = selection?.kind === 'participant' ? this.participants.get(selection.id) : undefined;
    const topBox = participant?.boxes[0];
    if (topBox) {
      const box = topBox.el.getBBox();
      const t = parseTranslate(topBox.el.getAttribute('transform'));
      const margin = 3;
      this.selectionBox.removeAttribute('display');
      this.selectionBox.setAttribute('x', String(box.x + t.x - margin));
      this.selectionBox.setAttribute('y', String(box.y + t.y - margin));
      this.selectionBox.setAttribute('width', String(box.width + margin * 2));
      this.selectionBox.setAttribute('height', String(box.height + margin * 2));
    } else {
      this.selectionBox.setAttribute('display', 'none');
    }
    let selectedMessage: Message | undefined;
    for (const message of this.messages) {
      const selected = selection?.kind === 'message' && message.key === selection.key;
      if (selected) selectedMessage = message;
      message.hit?.setAttribute('stroke', selected ? 'rgba(26, 115, 232, 0.25)' : 'transparent');
    }

    // 선택한 메시지 양 끝의 ■ 핸들: 끌어서 다른 참여자에 놓으면 보낸이·받는이가 바뀐다
    this.endpointGroup?.replaceChildren();
    const ends = selectedMessage ? this.messageEnds(selectedMessage) : null;
    if (ends) {
      (['start', 'end'] as const).forEach((end, i) => {
        const square = document.createElementNS(SVG_NS, 'rect');
        square.classList.add('unidia-endpoint');
        square.dataset.unidiaEndpoint = end;
        square.setAttribute('x', String(ends[i].x - ENDPOINT_SIZE / 2));
        square.setAttribute('y', String(ends[i].y - ENDPOINT_SIZE / 2));
        square.setAttribute('width', String(ENDPOINT_SIZE));
        square.setAttribute('height', String(ENDPOINT_SIZE));
        square.setAttribute('fill', ACCENT);
        square.setAttribute('stroke', '#fff');
        square.setAttribute('stroke-width', '1');
        square.setAttribute('vector-effect', 'non-scaling-stroke');
        this.endpointGroup!.appendChild(square);
      });
    }
  }

  /* 메시지의 보낸이 쪽·받는이 쪽 끝 (생명선 위). 자기 자신에게 보내는 메시지는 곡선의 위·아래 끝. */
  private messageEnds(message: Message): [Point, Point] | null {
    const from = message.from ? this.participants.get(message.from) : undefined;
    const to = message.to ? this.participants.get(message.to) : undefined;
    if (!from || !to) return null;
    const y = message.y + message.dy;
    return [
      { x: from.x, y },
      { x: to.x, y: y + message.height },
    ];
  }

  /* 옮긴 참여자가 잘리지 않도록 보이는 영역(viewBox)을 다이어그램 전체에 맞춘다. */
  private fitViewBox(): void {
    const svg = this.svg;
    if (!svg) return;
    for (const group of [this.hitGroup, this.overlayGroup]) group?.setAttribute('display', 'none');
    const box = svg.getBBox();
    for (const group of [this.hitGroup, this.overlayGroup]) group?.removeAttribute('display');
    if (box.width <= 0 || box.height <= 0) return;
    const x = box.x - FIT_PADDING;
    const y = box.y - FIT_PADDING;
    const width = box.width + FIT_PADDING * 2;
    const height = box.height + FIT_PADDING * 2;
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    svg.style.maxWidth = `${width}px`;
  }

  // ── 마우스 조작 ────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.svg) return;
    const target = e.target as Element;

    const endpointEl = target.closest<SVGElement>('[data-unidia-endpoint]');
    const selected = this.selection;
    const selectedMessage =
      selected?.kind === 'message' ? this.messages.find((m) => m.key === selected.key) : undefined;
    if (endpointEl && selectedMessage) {
      this.dragMessageEnd(e, selectedMessage, endpointEl.dataset.unidiaEndpoint === 'start' ? 'start' : 'end');
      return;
    }

    const id = target.closest<SVGElement>('[data-unidia-participant]')?.dataset.unidiaParticipant;
    const participant = id ? this.participants.get(id) : undefined;
    if (id && participant) {
      this.select({ kind: 'participant', id });
      this.dragParticipant(e, participant);
      return;
    }

    const key = target.closest<SVGElement>('[data-unidia-message]')?.dataset.unidiaMessage;
    const message = key ? this.messages.find((candidate) => candidate.key === key) : undefined;
    if (key && message) {
      this.select({ kind: 'message', key });
      this.dragMessage(e, message);
      return;
    }

    this.select(null);
  }

  /* 참여자 좌우 이동: 생명선·상자·노트가 함께 움직이고, 연결된 메시지는 늘어나거나 줄어든다. */
  private dragParticipant(e: PointerEvent, participant: Participant): void {
    const key = SEQUENCE_KEY_PREFIX + participant.id;
    const originX = participant.x;
    const wasCustom = participant.custom;
    const prev = this.savedLayouts[key] ? { ...this.savedLayouts[key] } : undefined;
    const redraw = () => {
      this.applyParticipant(participant);
      for (const message of this.messagesOf(participant.id)) this.applyMessage(message);
    };

    this.trackPointer(e, {
      move: (dx) => {
        participant.x = originX + dx;
        participant.custom = true;
        redraw();
        this.options.onLayoutPreview(key, { x: participant.x, y: 0 });
      },
      commit: () => this.options.onLayoutCommit(key, { x: participant.x, y: 0 }, prev),
      cancel: () => {
        participant.x = originX;
        participant.custom = wasCustom;
        redraw();
        this.options.onLayoutPreview(key, prev);
      },
    });
  }

  /*
   * 메시지 위아래 이동.
   * - 바로 위·아래 메시지 사이에 놓으면: 간격만 바뀐다 (SetEdgePathCommand로 기록).
   * - 다른 메시지를 넘어가면: 놓일 자리에 초록 점선이 보이고, 놓으면 순서가 바뀐다 (코드의 메시지 줄을 옮김).
   */
  private dragMessage(e: PointerEvent, message: Message): void {
    if (!message.key) return;
    const key = message.key;
    const index = this.messages.indexOf(message);
    const originDy = message.dy;
    const currentY = message.y + originDy;
    // 나를 뺀 나머지 메시지의 세로 위치 (메시지 순서대로 = 위에서 아래로)
    const others = this.messages.filter((m) => m !== message).map((m) => m.y + m.dy);
    const top = this.top + MIN_MESSAGE_GAP;
    const bottom = this.bottom - MIN_MESSAGE_GAP;
    const gapRange = messageRange(currentY, others, top, bottom, MIN_MESSAGE_GAP);
    const prev = this.savedPaths[key] ? this.savedPaths[key].map((p) => ({ ...p })) : undefined;
    const value = () => (message.dy !== 0 ? [{ x: 0, y: message.dy }] : undefined);
    let target = index;

    this.trackPointer(e, {
      move: (_dx, dy) => {
        const y = clamp(currentY + dy, top, bottom);
        target = insertionIndex(y, others);
        if (target === index) {
          message.dy = clamp(y, gapRange.min, gapRange.max) - message.y;
          this.showIndicator(null, others);
          this.options.onEdgePathPreview(key, value());
        } else {
          message.dy = y - message.y; // 다른 메시지를 넘어가는 중: 마우스를 그대로 따라간다
          this.showIndicator(target, others);
        }
        this.applyMessage(message);
      },
      commit: () => {
        this.showIndicator(null, others);
        if (target === index) {
          this.options.onEdgePathCommit(key, value(), prev);
          return;
        }
        // 순서 변경: 화면은 원래대로 돌려 두고, 코드가 바뀌면 Mermaid가 새 순서로 다시 그린다
        message.dy = originDy;
        this.applyMessage(message);
        this.options.onEdgePathPreview(key, prev);
        this.options.onMessageReorder(index, target, key);
      },
      cancel: () => {
        this.showIndicator(null, others);
        message.dy = originDy;
        this.applyMessage(message);
        this.options.onEdgePathPreview(key, prev);
      },
    });
  }

  /*
   * 메시지 끝 ■ 핸들을 끌어 다른 참여자 생명선에 놓으면 보낸이(start)나 받는이(end)를 바꾼다.
   * 끄는 동안 반대쪽 끝에서 마우스까지 점선을 그리고, 가장 가까운 생명선을 초록색으로 강조한다.
   */
  private dragMessageEnd(e: PointerEvent, message: Message, end: 'start' | 'end'): void {
    const ends = this.messageEnds(message);
    if (!ends) return;
    const index = this.messages.indexOf(message);
    const [startPoint, endPoint] = ends;
    const fixed = end === 'start' ? endPoint : startPoint;
    const grabbed = end === 'start' ? startPoint : endPoint;
    const current = end === 'start' ? message.from : message.to;
    const lifelines = () => [...this.participants.values()].map((p) => ({ id: p.id, value: p.x }));
    let target: string | null = null;

    this.trackPointer(e, {
      move: (dx, dy) => {
        const cursor = { x: grabbed.x + dx, y: grabbed.y + dy };
        const hovered = nearestById(cursor.x, lifelines(), LIFELINE_PICK_DISTANCE);
        target = hovered !== current ? hovered : null;
        this.drawReconnect(fixed, cursor, target);
      },
      commit: () => {
        this.reconnectGroup?.replaceChildren();
        if (target) this.options.onMessageReconnect(index, end, target, message.key);
      },
      cancel: () => this.reconnectGroup?.replaceChildren(),
    });
  }

  private drawReconnect(from: Point, cursor: Point, target: string | null): void {
    const group = this.reconnectGroup;
    if (!group) return;
    group.replaceChildren();
    group.appendChild(svgLine(from, cursor, ACCENT, '5 4', 1.5));
    const participant = target ? this.participants.get(target) : undefined;
    if (participant) {
      const top = { x: participant.x, y: this.top };
      const bottom = { x: participant.x, y: this.bottom };
      group.appendChild(svgLine(top, bottom, REORDER_COLOR, '4 3', 3));
    }
  }

  /* 메시지가 놓일 자리(target번째 앞)에 가로 점선을 그린다. target이 null이면 숨긴다. */
  private showIndicator(target: number | null, others: readonly number[]): void {
    const indicator = this.indicator;
    if (!indicator) return;
    if (target === null) {
      indicator.setAttribute('display', 'none');
      return;
    }
    const above = target > 0 ? others[target - 1] : this.top;
    const below = target < others.length ? others[target] : this.bottom;
    const y = (above + below) / 2;
    const xs = [...this.participants.values()].map((p) => p.x);
    indicator.setAttribute('x1', String(Math.min(...xs) - INDICATOR_OVERHANG));
    indicator.setAttribute('x2', String(Math.max(...xs) + INDICATOR_OVERHANG));
    indicator.setAttribute('y1', String(y));
    indicator.setAttribute('y2', String(y));
    indicator.removeAttribute('display');
  }

  /* 드래그 공통 처리 (ClassDiagramOverlay와 같은 방식): 화면 갱신 주기마다 move, 움직였으면 놓을 때 commit. */
  private trackPointer(
    e: PointerEvent,
    handlers: { move(dx: number, dy: number): void; commit(): void; cancel(): void },
  ): void {
    e.preventDefault();
    const start = this.toDiagramPoint(e);
    let latest = e;
    let changed = false;

    const update = () => {
      this.frame = 0;
      const point = this.toDiagramPoint(latest);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (!changed && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      changed = true;
      handlers.move(dx, dy);
      this.updateSelection();
    };
    const onMove = (ev: PointerEvent) => {
      latest = ev;
      if (!this.frame) this.frame = requestAnimationFrame(update);
    };
    const onUp = (ev: PointerEvent) => {
      stop();
      cancelAnimationFrame(this.frame);
      latest = ev;
      update();
      if (changed) handlers.commit();
    };
    const onCancel = () => {
      stop();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      handlers.cancel();
      this.updateSelection();
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    this.cleanups.push(stop);
  }

  /* 화면 좌표(마우스) → 다이어그램 좌표 */
  private toDiagramPoint(e: MouseEvent): Point {
    const ctm = this.svg?.getScreenCTM();
    if (!ctm) return { x: e.clientX, y: e.clientY };
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }
}

function svgLine(a: Point, b: Point, color: string, dash: string, width: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(a.x));
  line.setAttribute('y1', String(a.y));
  line.setAttribute('x2', String(b.x));
  line.setAttribute('y2', String(b.y));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  line.setAttribute('stroke-dasharray', dash);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  return line;
}

function movable(el: SVGGraphicsElement): Movable {
  return { el, original: el.getAttribute('transform') };
}

function shift(item: Movable, dx: number, dy: number): void {
  setTransform(item.el, dx === 0 && dy === 0 ? item.original : join(item.original, translate(dx, dy)));
}

function translate(dx: number, dy: number): string {
  return `translate(${dx}, ${dy})`;
}

function join(original: string | null, extra: string): string {
  return original ? `${original} ${extra}` : extra;
}

function setTransform(el: SVGElement, value: string | null): void {
  if (value) el.setAttribute('transform', value);
  else el.removeAttribute('transform');
}
