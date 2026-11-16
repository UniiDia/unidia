import type { NodeLayout, Point } from '../core/DiagramModel';
import type { OverlayLayer } from './OverlayLayer';
import {
  type SizedLayout,
  distanceToRect,
  edgeKey,
  layoutRect,
  parseClassNodeId,
  parseTranslate,
  pointAtHalfLength,
  polylinePath,
  resizeFromBottomRight,
  routeWithWaypoints,
  waypointInsertIndex,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_WIDTH = 40;
const MIN_HEIGHT = 30;
const HANDLE_SIZE = 10;
const WAYPOINT_RADIUS = 5;
/** 가는 선도 잡기 쉽도록 클릭 판정 폭(화면 px)을 넓힌다 */
const EDGE_HIT_WIDTH = 12;
const FIT_PADDING = 16;
/** 이 거리(px) 미만으로 움직이면 클릭으로 보고 편집으로 기록하지 않는다 */
const DRAG_THRESHOLD = 2;
/** 연결선 끝점이 노드에서 이 거리 안에 있어야 그 노드에 연결된 것으로 본다 */
const EDGE_SNAP_DISTANCE = 30;
const ACCENT = '#1a73e8';

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
  /** 저장용 이름 (양 끝 노드를 알 수 없거나 자기 자신으로 가는 선이면 null → 편집 불가) */
  key: string | null;
  start: Point;
  end: Point;
  /** 사용자가 넣은 꺾임점 (REQ-05) */
  waypoints: Point[];
  /** 클릭 판정용 투명한 굵은 선 */
  hit: SVGPathElement | null;
  label: SVGGElement | null;
  /** 다중성 표기("1", "*") */
  terminals: { el: SVGGElement; end: 'start' | 'end' }[];
}

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; key: string } | null;

export interface ClassDiagramOverlayOptions {
  /** 노드 드래그·크기 조절을 마쳤을 때. 모델 반영(Command 기록)은 호출한 쪽에서 한다. */
  onLayoutCommit(nodeId: string, layout: SizedLayout): void;
  /** 꺾임점을 추가·이동·삭제했을 때. 꺾임점이 모두 없어지면 undefined. */
  onEdgePathCommit(edgeKey: string, waypoints: Point[] | undefined): void;
}

/**
 * 클래스 다이어그램용 오버레이.
 * Mermaid가 그린 SVG를 그대로 두고, 그 위에서 노드 위치·크기와 연결선 경로만 바꾼다.
 * - REQ-02: 노드를 끌면 이동, 선택 후 오른쪽 아래 핸들로 크기 조절
 * - REQ-04: 옮긴 노드에 연결된 선은 끝점이 항상 노드 테두리에 붙도록 다시 그린다
 * - REQ-05: 선을 끌면 꺾임점이 생기고, 꺾임점을 끌어 이동, 더블클릭해 삭제 (선 더블클릭으로도 추가)
 * 결과는 콜백으로 넘기고, 모델은 코드와 별도로 저장한다 (REQ-03).
 */
export class ClassDiagramOverlay implements OverlayLayer {
  private svg: SVGSVGElement | null = null;
  private root: SVGGElement | null = null;
  private nodes = new Map<string, NodeInfo>();
  private edges: EdgeInfo[] = [];
  private overlayGroup: SVGGElement | null = null;
  private selectionBox: SVGRectElement | null = null;
  private handle: SVGRectElement | null = null;
  private waypointGroup: SVGGElement | null = null;
  private hitGroup: SVGGElement | null = null;
  /** 다시 그려져도 선택을 유지하기 위해 detach 때 지우지 않는다 */
  private selection: Selection = null;
  private cleanups: (() => void)[] = [];
  private frame = 0;

  constructor(private options: ClassDiagramOverlayOptions) {}

  attach(
    svg: SVGSVGElement,
    layouts: Record<string, NodeLayout> = {},
    edgePaths: Record<string, Point[]> = {},
  ): void {
    this.detach();
    const root = svg.querySelector<SVGGElement>('g.root');
    if (!root) return;
    this.svg = svg;
    this.root = root;
    svg.classList.add('unidia-editable');
    svg.style.overflow = 'visible';

    this.collectNodes(root);
    this.collectEdges(root);
    this.createEdgeHitAreas(root);
    this.createSelectionLayer(root);

    let changed = false;
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
      changed = true;
      this.applyNode(node);
    }
    for (const edge of this.edges) {
      const saved = edge.key ? edgePaths[edge.key] : undefined;
      if (saved && saved.length > 0) {
        edge.waypoints = saved.map((p) => ({ x: p.x, y: p.y }));
        changed = true;
      }
    }
    if (changed) {
      for (const edge of this.edges) this.routeEdge(edge);
      this.fitViewBox();
    }

    if (!this.selectionExists()) this.selection = null;
    this.updateSelection();

    const onPointerDown = (e: PointerEvent) => this.onPointerDown(e);
    const onDoubleClick = (e: MouseEvent) => this.onDoubleClick(e);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('dblclick', onDoubleClick);
    this.cleanups.push(() => {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('dblclick', onDoubleClick);
    });
  }

  detach(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.overlayGroup?.remove();
    this.hitGroup?.remove();
    this.overlayGroup = this.selectionBox = this.handle = this.waypointGroup = this.hitGroup = null;
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

    const occurrences = new Map<string, number>();
    for (const el of root.querySelectorAll<SVGPathElement>('g.edgePaths path[data-id]')) {
      const id = el.dataset.id!;
      const points = decodePoints(el.dataset.points);
      if (points.length < 2) continue;
      const start = points[0];
      const end = points[points.length - 1];
      const from = nearestNode(start);
      const to = nearestNode(end);

      let key: string | null = null;
      if (from && to && from !== to) {
        const pair = `${from}->${to}`;
        const n = occurrences.get(pair) ?? 0;
        occurrences.set(pair, n + 1);
        key = edgeKey(from, to, n);
      }

      const labelInner = root.querySelector(`g.edgeLabels g.label[data-id="${CSS.escape(id)}"]`);
      const label =
        labelInner?.parentElement instanceof SVGGElement &&
        labelInner.parentElement.classList.contains('edgeLabel')
          ? labelInner.parentElement
          : null;
      this.edges.push({ el, from, to, key, start, end, waypoints: [], hit: null, label, terminals: [] });
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

  /** 편집 가능한 선마다 투명한 굵은 선을 깔아 클릭하기 쉽게 한다 (노드보다 아래 층). */
  private createEdgeHitAreas(root: SVGGElement): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('unidia-edge-hits');
    for (const edge of this.edges) {
      if (!edge.key) continue;
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.classList.add('unidia-edge-hit');
      hit.dataset.unidiaEdge = edge.key;
      hit.setAttribute('d', edge.el.getAttribute('d') ?? '');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', String(EDGE_HIT_WIDTH));
      hit.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      hit.setAttribute('pointer-events', 'stroke');
      group.appendChild(hit);
      edge.hit = hit;
    }
    const edgePaths = root.querySelector(':scope > g.edgePaths');
    if (edgePaths) edgePaths.after(group);
    else root.prepend(group);
    this.hitGroup = group;
  }

  private createSelectionLayer(root: SVGGElement): void {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('unidia-overlay');

    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', ACCENT);
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
    handle.setAttribute('stroke', ACCENT);
    handle.setAttribute('stroke-width', '1.5');
    handle.setAttribute('vector-effect', 'non-scaling-stroke');

    const waypoints = document.createElementNS(SVG_NS, 'g');
    waypoints.classList.add('unidia-waypoints');

    group.append(box, handle, waypoints);
    root.appendChild(group);
    this.overlayGroup = group;
    this.selectionBox = box;
    this.handle = handle;
    this.waypointGroup = waypoints;
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

  /** 지금 화면에 그려진 선의 전체 경유점 [시작, ...꺾임점, 끝] */
  private currentRoute(edge: EdgeInfo): Point[] | null {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!from || !to || from === to) return null;
    return routeWithWaypoints(layoutRect(from.current), layoutRect(to.current), edge.waypoints);
  }

  /**
   * 선을 다시 그린다. 양 끝 노드가 그대로이고 꺾임점도 없으면 Mermaid가 그린 곡선을 유지하고,
   * 그 밖에는 노드 테두리에서 시작해 꺾임점을 지나는 직선 구간으로 그린다.
   */
  private routeEdge(edge: EdgeInfo): void {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!from || !to || from === to) return; // 자기 자신으로 가는 선은 아직 처리하지 않는다
    if (!from.custom && !to.custom && edge.waypoints.length === 0) return;

    const route = this.currentRoute(edge)!;
    const d = polylinePath(route);
    edge.el.setAttribute('d', d);
    edge.hit?.setAttribute('d', d);

    const middle = pointAtHalfLength(route);
    edge.label?.setAttribute('transform', `translate(${middle.x}, ${middle.y})`);

    for (const terminal of edge.terminals) {
      // 선 끝에서 조금 안쪽, 선 옆으로 살짝 비켜서 표시
      const [anchor, next] =
        terminal.end === 'start' ? [route[0], route[1]] : [route[route.length - 1], route[route.length - 2]];
      const length = Math.hypot(next.x - anchor.x, next.y - anchor.y);
      if (length === 0) continue;
      const ux = (next.x - anchor.x) / length;
      const uy = (next.y - anchor.y) / length;
      const tx = anchor.x + ux * 18 - uy * 10;
      const ty = anchor.y + uy * 18 + ux * 10;
      terminal.el.setAttribute('transform', `translate(${tx}, ${ty})`);
    }
  }

  private selectionExists(): boolean {
    if (!this.selection) return false;
    if (this.selection.kind === 'node') return this.nodes.has(this.selection.id);
    const key = this.selection.key;
    return this.edges.some((edge) => edge.key === key);
  }

  private selectedEdge(): EdgeInfo | undefined {
    const selection = this.selection;
    return selection?.kind === 'edge' ? this.edges.find((edge) => edge.key === selection.key) : undefined;
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.updateSelection();
  }

  private updateSelection(): void {
    if (!this.overlayGroup || !this.selectionBox || !this.handle || !this.waypointGroup) return;

    // 노드 선택: 점선 테두리 + 크기 조절 핸들
    const node = this.selection?.kind === 'node' ? this.nodes.get(this.selection.id) : undefined;
    const nodeVisible = node ? null : 'none';
    setDisplay(this.selectionBox, nodeVisible);
    setDisplay(this.handle, nodeVisible);
    if (node) {
      const rect = layoutRect(node.current);
      const margin = 3;
      this.selectionBox.setAttribute('x', String(rect.x - margin));
      this.selectionBox.setAttribute('y', String(rect.y - margin));
      this.selectionBox.setAttribute('width', String(rect.width + margin * 2));
      this.selectionBox.setAttribute('height', String(rect.height + margin * 2));
      this.handle.setAttribute('x', String(rect.x + rect.width - HANDLE_SIZE / 2));
      this.handle.setAttribute('y', String(rect.y + rect.height - HANDLE_SIZE / 2));
    }

    // 선 선택: 선 강조 + 꺾임점 핸들
    const edge = this.selectedEdge();
    for (const other of this.edges) {
      other.hit?.setAttribute('stroke', other === edge ? 'rgba(26, 115, 232, 0.25)' : 'transparent');
    }
    this.waypointGroup.replaceChildren();
    edge?.waypoints.forEach((point, index) => {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.classList.add('unidia-waypoint');
      circle.dataset.unidiaWaypoint = String(index);
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', String(WAYPOINT_RADIUS));
      circle.setAttribute('fill', '#fff');
      circle.setAttribute('stroke', ACCENT);
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('vector-effect', 'non-scaling-stroke');
      this.waypointGroup!.appendChild(circle);
    });
  }

  /** 옮긴 노드·꺾은 선이 잘리지 않도록 보이는 영역(viewBox)을 다이어그램 전체에 맞춘다. */
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

    const waypointEl = target.closest<SVGElement>('[data-unidia-waypoint]');
    const edge = this.selectedEdge();
    if (waypointEl && edge) {
      this.dragWaypoint(e, edge, Number(waypointEl.dataset.unidiaWaypoint));
      return;
    }

    if (this.selection?.kind === 'node' && target.closest('[data-unidia-handle]')) {
      this.dragNode(e, this.selection.id, 'resize');
      return;
    }

    const id = target.closest<SVGGElement>('g.node')?.dataset.unidiaNode;
    if (id && this.nodes.has(id)) {
      this.select({ kind: 'node', id });
      this.dragNode(e, id, 'move');
      return;
    }

    const key = target.closest<SVGElement>('[data-unidia-edge]')?.dataset.unidiaEdge;
    const hitEdge = key ? this.edges.find((candidate) => candidate.key === key) : undefined;
    if (key && hitEdge) {
      this.select({ kind: 'edge', key });
      this.bendEdge(e, hitEdge);
      return;
    }

    this.select(null);
  }

  /** 꺾임점 더블클릭 → 삭제, 선 더블클릭 → 그 자리에 꺾임점 추가 */
  private onDoubleClick(e: MouseEvent): void {
    const target = e.target as Element;
    const edge = this.selectedEdge();

    const waypointEl = target.closest<SVGElement>('[data-unidia-waypoint]');
    if (waypointEl && edge?.key) {
      e.preventDefault();
      const index = Number(waypointEl.dataset.unidiaWaypoint);
      const next = edge.waypoints.filter((_, i) => i !== index);
      this.options.onEdgePathCommit(edge.key, next.length > 0 ? next : undefined);
      return;
    }

    const key = target.closest<SVGElement>('[data-unidia-edge]')?.dataset.unidiaEdge;
    const hitEdge = key ? this.edges.find((candidate) => candidate.key === key) : undefined;
    const route = hitEdge ? this.currentRoute(hitEdge) : null;
    if (key && hitEdge && route) {
      e.preventDefault();
      const point = this.toDiagramPoint(e);
      const next = [...hitEdge.waypoints];
      next.splice(waypointInsertIndex(route, point), 0, point);
      this.selection = { kind: 'edge', key };
      this.options.onEdgePathCommit(key, next);
    }
  }

  private dragNode(e: PointerEvent, id: string, mode: 'move' | 'resize'): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const origin = { ...node.current };
    const wasCustom = node.custom;

    this.trackPointer(e, {
      move: (dx, dy) => {
        node.current =
          mode === 'move'
            ? { ...origin, x: origin.x + dx, y: origin.y + dy }
            : resizeFromBottomRight(origin, dx, dy, MIN_WIDTH, MIN_HEIGHT);
        node.custom = true;
        this.applyNode(node);
        this.rerouteEdgesOf(id);
      },
      commit: () => this.options.onLayoutCommit(id, { ...node.current }),
      cancel: () => {
        node.current = origin;
        node.custom = wasCustom;
        this.applyNode(node);
        this.rerouteEdgesOf(id);
      },
    });
  }

  private dragWaypoint(e: PointerEvent, edge: EdgeInfo, index: number): void {
    if (!edge.key || index < 0 || index >= edge.waypoints.length) return;
    const key = edge.key;
    const origin = edge.waypoints.map((p) => ({ ...p }));

    this.trackPointer(e, {
      move: (dx, dy) => {
        edge.waypoints = origin.map((p, i) => (i === index ? { x: p.x + dx, y: p.y + dy } : p));
        this.routeEdge(edge);
      },
      commit: () => this.options.onEdgePathCommit(key, edge.waypoints.map((p) => ({ ...p }))),
      cancel: () => {
        edge.waypoints = origin;
        this.routeEdge(edge);
      },
    });
  }

  /** 선을 잡고 끌면 그 자리에 꺾임점이 생기고 바로 끌려온다. 그냥 클릭이면 선택만 한다. */
  private bendEdge(e: PointerEvent, edge: EdgeInfo): void {
    const route = this.currentRoute(edge);
    if (!edge.key || !route) return;
    const key = edge.key;
    const origin = edge.waypoints.map((p) => ({ ...p }));
    const start = this.toDiagramPoint(e);
    const index = waypointInsertIndex(route, start);

    this.trackPointer(e, {
      move: (dx, dy) => {
        const next = origin.map((p) => ({ ...p }));
        next.splice(index, 0, { x: start.x + dx, y: start.y + dy });
        edge.waypoints = next;
        this.routeEdge(edge);
      },
      commit: () => this.options.onEdgePathCommit(key, edge.waypoints.map((p) => ({ ...p }))),
      cancel: () => {
        edge.waypoints = origin;
        this.routeEdge(edge);
      },
    });
  }

  /**
   * 드래그 공통 처리: 화면 갱신 주기에 맞춰 move를 부르고(60fps 목표),
   * 조금이라도 움직였으면 놓을 때 commit, 취소되면 cancel.
   */
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

  private rerouteEdgesOf(id: string): void {
    for (const edge of this.edges) {
      if (edge.from === id || edge.to === id) this.routeEdge(edge);
    }
  }

  /** 화면 좌표(마우스) → 다이어그램 좌표 */
  private toDiagramPoint(e: MouseEvent): Point {
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

function setDisplay(el: SVGElement, value: 'none' | null): void {
  if (value) el.setAttribute('display', value);
  else el.removeAttribute('display');
}
