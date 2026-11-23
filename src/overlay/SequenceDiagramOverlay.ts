import type { NodeLayout, Point } from '../core/DiagramModel';
import type { OverlayCallbacks, OverlayLayer } from './OverlayLayer';
import { assignMessageKeys, clamp, messageRange, nearestById, noteOwner, parseTranslate } from './geometry';

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
  original: string | null;
  /* 사용자가 위아래로 옮긴 양 */
  dy: number;
  hit: SVGLineElement | SVGPathElement | null;
}

type Selection = { kind: 'participant'; id: string } | { kind: 'message'; key: string } | null;

/*
 * 시퀀스 다이어그램용 오버레이. 시퀀스에서는 위→아래 순서가 곧 시간 순서라 클래스 다이어그램처럼
 * 자유롭게 옮기지 않고, 시퀀스에 맞는 두 가지 움직임만 제공한다.
 * - 참여자 좌우 이동 (REQ-02): 위·아래 상자를 끌면 생명선과 함께 옆으로 움직인다.
 *   연결된 메시지 화살표는 양 끝이 생명선에 붙은 채 늘어나거나 줄어든다 (REQ-04). 노트·활성 상자도 따라간다.
 * - 메시지 간격 조정: 메시지 화살표를 위아래로 끈다. 바로 위·아래 메시지를 넘지 못해 순서는 유지된다.
 * 결과는 클래스 다이어그램과 같은 방식으로 콜백에 넘긴다 (미리보기 → { prev }로 한 번 기록).
 */
export class SequenceDiagramOverlay implements OverlayLayer {
  private svg: SVGSVGElement | null = null;
  private participants = new Map<string, Participant>();
  private messages: Message[] = [];
  private hitGroup: SVGGElement | null = null;
  private overlayGroup: SVGGElement | null = null;
  private selectionBox: SVGRectElement | null = null;
  /* 메시지가 올라갈 수 있는 가장 위 / 내려갈 수 있는 가장 아래 */
  private top = 0;
  private bottom = 0;
  /* 다시 그려져도 선택을 유지하기 위해 detach 때 지우지 않는다 */
  private selection: Selection = null;
  private savedLayouts: Record<string, NodeLayout> = {};
  private savedPaths: Record<string, Point[]> = {};
  private cleanups: (() => void)[] = [];
  private frame = 0;

  constructor(private options: OverlayCallbacks) {}

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
    this.hitGroup = this.overlayGroup = this.selectionBox = null;
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
        });
      } else {
        const box = el.getBBox();
        const owner = nearestById(box.x, lifelines, LIFELINE_SNAP_DISTANCE);
        found.push({ ...base, el, from: owner, to: owner, self: true, x1: box.x, x2: box.x, y: box.y });
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
    group.appendChild(box);
    svg.appendChild(group);
    this.overlayGroup = group;
    this.selectionBox = box;
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
    for (const message of this.messages) {
      const selected = selection?.kind === 'message' && message.key === selection.key;
      message.hit?.setAttribute('stroke', selected ? 'rgba(26, 115, 232, 0.25)' : 'transparent');
    }
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

  /* 메시지 위아래 이동: 바로 위·아래 메시지 사이에서만 움직여 순서(시간)는 그대로 둔다. */
  private dragMessage(e: PointerEvent, message: Message): void {
    if (!message.key) return;
    const key = message.key;
    const originDy = message.dy;
    const currentY = message.y + originDy;
    const others = this.messages.filter((m) => m !== message).map((m) => m.y + m.dy);
    const range = messageRange(currentY, others, this.top + MIN_MESSAGE_GAP, this.bottom - MIN_MESSAGE_GAP, MIN_MESSAGE_GAP);
    const prev = this.savedPaths[key] ? this.savedPaths[key].map((p) => ({ ...p })) : undefined;
    const value = () => (message.dy !== 0 ? [{ x: 0, y: message.dy }] : undefined);

    this.trackPointer(e, {
      move: (_dx, dy) => {
        message.dy = clamp(currentY + dy, range.min, range.max) - message.y;
        this.applyMessage(message);
        this.options.onEdgePathPreview(key, value());
      },
      commit: () => this.options.onEdgePathCommit(key, value(), prev),
      cancel: () => {
        message.dy = originDy;
        this.applyMessage(message);
        this.options.onEdgePathPreview(key, prev);
      },
    });
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
