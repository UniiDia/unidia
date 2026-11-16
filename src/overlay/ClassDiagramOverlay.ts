import type { NodeLayout, Point } from '../core/DiagramModel';
import type { OverlayLayer } from './OverlayLayer';
import {
  type SizedLayout,
  distanceToRect,
  layoutRect,
  parseClassNodeId,
  parseTranslate,
  resizeFromBottomRight,
  straightEdge,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_WIDTH = 40;
const MIN_HEIGHT = 30;
const HANDLE_SIZE = 10;
const FIT_PADDING = 16;
/** 이 거리(px) 미만으로 움직이면 클릭으로 보고 편집으로 기록하지 않는다 */
const DRAG_THRESHOLD = 2;
/** 연결선 끝점이 노드에서 이 거리 안에 있어야 그 노드에 연결된 것으로 본다 */
const EDGE_SNAP_DISTANCE = 30;

interface TextGroup {
  el: SVGGElement;
  original: string | null;
  base: Point;
  /** 제목처럼 가운데 정렬된 텍스트인지 */
  centered: boolean;
}

interface ShapeGroup {
  el: SVGGElement;
  original: string | null;
}

interface NodeInfo {
  id: string;
  el: SVGGElement;
  /** Mermaid가 처음 배치한 위치·크기 */
  base: SizedLayout;
  /** g.node의 translate와 도형 중심 사이의 차이 */
  offset: Point;
  current: SizedLayout;
  shapes: ShapeGroup[];
  texts: TextGroup[];
  /** GUI에서 위치·크기를 바꾼 노드인지 (바꾼 노드에 붙은 선만 다시 그린다) */
  custom: boolean;
}

interface EdgeInfo {
  el: SVGPathElement;
  from: string | null;
  to: string | null;
  start: Point;
  end: Point;
  label: SVGGElement | null;
  /** 다중성 표기("1", "*") */
  terminals: { el: SVGGElement; end: 'start' | 'end' }[];
}

export interface ClassDiagramOverlayOptions {
  /** 드래그·크기 조절을 마쳤을 때 호출된다. 모델 반영(Command 기록)은 호출한 쪽에서 한다. */
  onLayoutCommit(nodeId: string, layout: SizedLayout): void;
}

/**
 * 클래스 다이어그램용 오버레이 (REQ-02, REQ-04 기본형).
 * Mermaid가 그린 SVG를 그대로 두고, 그 위에서 노드의 위치·크기만 바꾼다.
 * - 노드를 끌면 이동, 선택 후 오른쪽 아래 핸들을 끌면 크기 조절
 * - 위치·크기를 바꾼 노드에 연결된 선은 노드 테두리를 잇는 직선으로 다시 그린다
 * - 결과는 onLayoutCommit으로 넘기고, 모델은 코드와 별도로 저장한다 (REQ-03)
 */
export class ClassDiagramOverlay implements OverlayLayer {
  private svg: SVGSVGElement | null = null;
  private root: SVGGElement | null = null;
  private nodes = new Map<string, NodeInfo>();
  private edges: EdgeInfo[] = [];
  private overlayGroup: SVGGElement | null = null;
  private selectionBox: SVGRectElement | null = null;
  private handle: SVGRectElement | null = null;
  /** 다시 그려져도 선택을 유지하기 위해 detach 때 지우지 않는다 */
  private selectedId: string | null = null;
  private cleanups: (() => void)[] = [];
  private frame = 0;

  constructor(private options: ClassDiagramOverlayOptions) {}

  attach(svg: SVGSVGElement, layouts: Record<string, NodeLayout> = {}): void {
    this.detach();
    const root = svg.querySelector<SVGGElement>('g.root');
    if (!root) return;
    this.svg = svg;
    this.root = root;
    svg.classList.add('unidia-editable');
    svg.style.overflow = 'visible';

    this.collectNodes(root);
    this.collectEdges(root);
    this.createSelectionLayer(root);

    let hasCustom = false;
    for (const [id, layout] of Object.entries(layouts)) {
      const node = this.nodes.get(id);
      if (!node) continue;
      node.current = {
        x: layout.x,
        y: layout.y,
        width: layout.width ?? node.base.width,
        height: layout.height ?? node.base.height,
      };
      node.custom = true;
      hasCustom = true;
      this.applyNode(node);
    }
    if (hasCustom) {
      for (const edge of this.edges) this.rerouteIfNeeded(edge);
      this.fitViewBox();
    }

    if (this.selectedId && !this.nodes.has(this.selectedId)) this.selectedId = null;
    this.updateSelection();

    const onPointerDown = (e: PointerEvent) => this.onPointerDown(e);
    svg.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() => svg.removeEventListener('pointerdown', onPointerDown));
  }

  detach(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.overlayGroup?.remove();
    this.overlayGroup = this.selectionBox = this.handle = null;
    this.svg = this.root = null;
    this.nodes.clear();
    this.edges = [];
  }

  // ── SVG 분석 ──────────────────────────────────────────────

  private collectNodes(root: SVGGElement): void {
    for (const el of root.querySelectorAll<SVGGElement>('g.node')) {
      const id = parseClassNodeId(el.id);
      const container = el.querySelector<SVGGElement>(':scope > .label-container');
      if (!id || !container) continue;

      const box = container.getBBox();
      if (box.width <= 0 || box.height <= 0) continue;
      const translate = parseTranslate(el.getAttribute('transform'));
      const offset = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const base: SizedLayout = {
        x: translate.x + offset.x,
        y: translate.y + offset.y,
        width: box.width,
        height: box.height,
      };

      const shapes: ShapeGroup[] = [];
      const texts: TextGroup[] = [];
      for (const child of el.children) {
        if (!(child instanceof SVGGElement)) continue;
        if (child.classList.contains('label-container') || child.classList.contains('divider')) {
          // 크기 조절 시 선 두께는 그대로 두고 도형만 늘린다
          for (const line of child.querySelectorAll('path, line, rect, polygon')) {
            line.setAttribute('vector-effect', 'non-scaling-stroke');
          }
          shapes.push({ el: child, original: child.getAttribute('transform') });
        } else if (child.classList.contains('text')) {
          const original = child.getAttribute('transform');
          texts.push({
            el: child,
            original,
            base: parseTranslate(original),
            centered:
              child.classList.contains('label-group') ||
              child.classList.contains('annotation-group'),
          });
        }
      }

      el.dataset.unidiaNode = id;
      this.nodes.set(id, { id, el, base, offset, current: { ...base }, shapes, texts, custom: false });
    }
  }

  private collectEdges(root: SVGGElement): void {
    const nearestNode = (point: Point): string | null => {
      let best: string | null = null;
      let bestDistance = EDGE_SNAP_DISTANCE;
      for (const node of this.nodes.values()) {
        const distance = distanceToRect(point, layoutRect(node.base));
        if (distance <= bestDistance) {
          best = node.id;
          bestDistance = distance;
        }
      }
      return best;
    };

    for (const el of root.querySelectorAll<SVGPathElement>('g.edgePaths path[data-id]')) {
      const id = el.dataset.id!;
      const points = decodePoints(el.dataset.points);
      if (points.length < 2) continue;
      const start = points[0];
      const end = points[points.length - 1];
      const labelInner = root.querySelector(`g.edgeLabels g.label[data-id="${CSS.escape(id)}"]`);
      const label =
        labelInner?.parentElement instanceof SVGGElement &&
        labelInner.parentElement.classList.contains('edgeLabel')
          ? labelInner.parentElement
          : null;
      this.edges.push({
        el,
        from: nearestNode(start),
        to: nearestNode(end),
        start,
        end,
        label,
        terminals: [],
      });
    }

    // 다중성 표기는 어느 선의 것인지 표시가 없어서, 가장 가까운 선 끝점에 붙인다.
    for (const el of root.querySelectorAll<SVGGElement>('g.edgeTerminals')) {
      const position = parseTranslate(el.getAttribute('transform'));
      let best: { edge: EdgeInfo; end: 'start' | 'end' } | null = null;
      let bestDistance = 60;
      for (const edge of this.edges) {
        for (const end of ['start', 'end'] as const) {
          const point = end === 'start' ? edge.start : edge.end;
          const distance = Math.hypot(point.x - position.x, point.y - position.y);
          if (distance < bestDistance) {
            best = { edge, end };
            bestDistance = distance;
          }
        }
      }
      best?.edge.terminals.push({ el, end: best.end });
    }
  }

  private createSelectionLayer(root: SVGGElement): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('unidia-overlay');

    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#1a73e8');
    box.setAttribute('stroke-width', '1.5');
    box.setAttribute('stroke-dasharray', '4 3');
    box.setAttribute('vector-effect', 'non-scaling-stroke');
    box.setAttribute('pointer-events', 'none');

    const handle = document.createElementNS(SVG_NS, 'rect');
    handle.classList.add('unidia-handle');
    handle.dataset.unidiaHandle = 'resize';
    handle.setAttribute('width', String(HANDLE_SIZE));
    handle.setAttribute('height', String(HANDLE_SIZE));
    handle.setAttribute('fill', '#fff');
    handle.setAttribute('stroke', '#1a73e8');
    handle.setAttribute('stroke-width', '1.5');
    handle.setAttribute('vector-effect', 'non-scaling-stroke');

    group.append(box, handle);
    root.appendChild(group);
    this.overlayGroup = group;
    this.selectionBox = box;
    this.handle = handle;
  }

  // ── 그리기 ────────────────────────────────────────────────

  private applyNode(node: NodeInfo): void {
    const { x, y, width, height } = node.current;
    node.el.setAttribute('transform', `translate(${x - node.offset.x}, ${y - node.offset.y})`);

    const sx = width / node.base.width;
    const sy = height / node.base.height;
    const resized = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
    // 글자는 찌그러지지 않도록 가로·세로 중 작은 비율로만 키운다 (REQ-06 방향)
    const textScale = Math.min(sx, sy);

    for (const shape of node.shapes) {
      setTransform(shape.el, resized ? join(shape.original, `scale(${sx}, ${sy})`) : shape.original);
    }
    for (const text of node.texts) {
      if (!resized) {
        setTransform(text.el, text.original);
        continue;
      }
      const tx = text.base.x * (text.centered ? textScale : sx);
      const ty = text.base.y * sy;
      text.el.setAttribute('transform', `translate(${tx}, ${ty}) scale(${textScale})`);
    }
  }

  private rerouteIfNeeded(edge: EdgeInfo): void {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!from || !to || from === to) return; // 자기 자신으로 가는 선은 아직 처리하지 않는다
    if (!from.custom && !to.custom) return;

    const [p1, p2] = straightEdge(layoutRect(from.current), layoutRect(to.current));
    edge.el.setAttribute('d', `M${p1.x},${p1.y}L${p2.x},${p2.y}`);
    edge.label?.setAttribute('transform', `translate(${(p1.x + p2.x) / 2}, ${(p1.y + p2.y) / 2})`);

    const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (length === 0) return;
    const ux = (p2.x - p1.x) / length;
    const uy = (p2.y - p1.y) / length;
    for (const terminal of edge.terminals) {
      // 선 끝에서 조금 안쪽, 선 옆으로 살짝 비켜서 표시
      const sign = terminal.end === 'start' ? 1 : -1;
      const anchor = terminal.end === 'start' ? p1 : p2;
      const tx = anchor.x + ux * 18 * sign - uy * 10;
      const ty = anchor.y + uy * 18 * sign + ux * 10;
      terminal.el.setAttribute('transform', `translate(${tx}, ${ty})`);
    }
  }

  private updateSelection(): void {
    const node = this.selectedId ? this.nodes.get(this.selectedId) : undefined;
    if (!this.overlayGroup || !this.selectionBox || !this.handle) return;
    if (!node) {
      this.overlayGroup.setAttribute('display', 'none');
      return;
    }
    this.overlayGroup.removeAttribute('display');
    const rect = layoutRect(node.current);
    const margin = 3;
    this.selectionBox.setAttribute('x', String(rect.x - margin));
    this.selectionBox.setAttribute('y', String(rect.y - margin));
    this.selectionBox.setAttribute('width', String(rect.width + margin * 2));
    this.selectionBox.setAttribute('height', String(rect.height + margin * 2));
    this.handle.setAttribute('x', String(rect.x + rect.width - HANDLE_SIZE / 2));
    this.handle.setAttribute('y', String(rect.y + rect.height - HANDLE_SIZE / 2));
  }

  /** 옮긴 노드가 잘리지 않도록 보이는 영역(viewBox)을 다이어그램 전체에 맞춘다. */
  private fitViewBox(): void {
    if (!this.svg || !this.root) return;
    const boxes: DOMRect[] = [];
    for (const selector of [':scope > g.nodes', ':scope > g.edgePaths']) {
      const group = this.root.querySelector<SVGGElement>(selector);
      if (group) boxes.push(group.getBBox());
    }
    for (const el of this.root.querySelectorAll<SVGGElement>('g.edgeLabel, g.edgeTerminals')) {
      const box = el.getBBox();
      if (box.width <= 0 || box.height <= 0) continue;
      const t = parseTranslate(el.getAttribute('transform'));
      boxes.push(new DOMRect(box.x + t.x, box.y + t.y, box.width, box.height));
    }
    const visible = boxes.filter((b) => b.width > 0 || b.height > 0);
    if (visible.length === 0) return;

    const minX = Math.min(...visible.map((b) => b.x)) - FIT_PADDING;
    const minY = Math.min(...visible.map((b) => b.y)) - FIT_PADDING;
    const maxX = Math.max(...visible.map((b) => b.x + b.width)) + FIT_PADDING;
    const maxY = Math.max(...visible.map((b) => b.y + b.height)) + FIT_PADDING;
    this.svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    this.svg.style.maxWidth = `${maxX - minX}px`;
  }

  // ── 마우스 조작 ────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.svg) return;
    const target = e.target as Element;

    if (this.selectedId && target.closest('[data-unidia-handle]')) {
      this.startGesture(e, this.selectedId, 'resize');
      return;
    }

    const id = target.closest<SVGGElement>('g.node')?.dataset.unidiaNode;
    if (id && this.nodes.has(id)) {
      this.selectedId = id;
      this.updateSelection();
      this.startGesture(e, id, 'move');
    } else {
      this.selectedId = null;
      this.updateSelection();
    }
  }

  private startGesture(e: PointerEvent, id: string, mode: 'move' | 'resize'): void {
    const node = this.nodes.get(id);
    if (!node) return;
    e.preventDefault();

    const origin = { ...node.current };
    const wasCustom = node.custom;
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
      node.current =
        mode === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : resizeFromBottomRight(origin, dx, dy, MIN_WIDTH, MIN_HEIGHT);
      node.custom = true;
      this.applyNode(node);
      this.rerouteEdgesOf(id);
      this.updateSelection();
    };

    const onMove = (ev: PointerEvent) => {
      latest = ev;
      // 화면 갱신 주기에 맞춰 한 번만 다시 그린다 (60fps 목표)
      if (!this.frame) this.frame = requestAnimationFrame(update);
    };
    const onUp = (ev: PointerEvent) => {
      stop();
      cancelAnimationFrame(this.frame);
      latest = ev;
      update();
      if (changed) this.options.onLayoutCommit(id, { ...node.current });
    };
    const onCancel = () => {
      stop();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      node.current = origin;
      node.custom = wasCustom;
      this.applyNode(node);
      this.rerouteEdgesOf(id);
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

  private rerouteEdgesOf(id: string): void {
    for (const edge of this.edges) {
      if (edge.from === id || edge.to === id) this.rerouteIfNeeded(edge);
    }
  }

  /** 화면 좌표(마우스) → 다이어그램 좌표 */
  private toDiagramPoint(e: PointerEvent): Point {
    const ctm = this.root?.getScreenCTM();
    if (!ctm) return { x: e.clientX, y: e.clientY };
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }
}

/** Mermaid가 data-points에 base64 JSON으로 넣어 둔 선의 경유점을 읽는다. */
function decodePoints(encoded: string | undefined): Point[] {
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(atob(encoded));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Point => typeof p?.x === 'number' && typeof p?.y === 'number',
    );
  } catch {
    return [];
  }
}

function join(original: string | null, extra: string): string {
  return original ? `${original} ${extra}` : extra;
}

function setTransform(el: SVGGElement, value: string | null): void {
  if (value) el.setAttribute('transform', value);
  else el.removeAttribute('transform');
}
