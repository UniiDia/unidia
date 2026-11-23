import type { NodeLayout, Point } from '../core/DiagramModel';
import type { OverlayCallbacks, OverlayLayer } from './OverlayLayer';
import {
  type SizedLayout,
  assignEdgeKeys,
  contentShift,
  decodeEdgePoints,
  distanceToRectBorder,
  findAttachedNode,
  layoutRect,
  parseClassNodeId,
  parseTranslate,
  pointAtHalfLength,
  polylinePath,
  trimRoute,
  resizeFromBottomRight,
  routeWithWaypoints,
  waypointInsertIndex,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLE_SIZE = 10;
const WAYPOINT_RADIUS = 5;
/* 가는 선도 잡기 쉽도록 클릭 판정 폭(화면 px)을 넓힌다 */
const EDGE_HIT_WIDTH = 12;
const FIT_PADDING = 16;
/* 이 거리(px) 미만으로 움직이면 클릭으로 보고 편집으로 기록하지 않는다 */
const DRAG_THRESHOLD = 2;
/* 연결선 끝점이 노드에서 이 거리 안에 있어야 그 노드에 연결된 것으로 본다 */
const EDGE_SNAP_DISTANCE = 30;
/* 화살촉 자리로 볼 수 있는 최대 거리 (Mermaid 화살촉은 20px 이내) */
const MAX_ARROW_GAP = 30;
const ACCENT = '#1a73e8';
/* 다시 연결할 대상 노드 강조색 */
const RECONNECT_COLOR = '#1e8e3e';
const ENDPOINT_SIZE = 8;

interface TextGroup {
  el: SVGGElement;
  original: string | null;
  base: Point;
  /* 제목처럼 가운데 정렬된 텍스트인지 */
  centered: boolean;
}

interface ShapeGroup {
  el: SVGGElement;
  original: string | null;
  /* box: 노드 테두리(가로·세로로 늘림), divider: 칸 구분선(가로로만 늘리고 글자와 함께 위쪽 기준 유지) */
  kind: 'box' | 'divider';
}

interface NodeInfo {
  id: string;
  el: SVGGElement;
  /* Mermaid가 처음 배치한 위치·크기 */
  base: SizedLayout;
  /* g.node의 translate와 도형 중심 사이의 차이 */
  offset: Point;
  current: SizedLayout;
  shapes: ShapeGroup[];
  texts: TextGroup[];
  /* GUI에서 위치·크기를 바꾼 노드인지 (바꾼 노드에 붙은 선만 다시 그린다) */
  custom: boolean;
}

interface EdgeInfo {
  el: SVGPathElement;
  from: string | null;
  to: string | null;
  /* 저장용 이름 (양 끝 노드를 알 수 없거나 자기 자신으로 가는 선이면 null → 편집 불가) */
  key: string | null;
  start: Point;
  end: Point;
  /* Mermaid가 화살촉 자리로 비워 둔 거리 (선 시작·끝이 노드 테두리에서 떨어진 만큼, 화살촉이 없으면 0) */
  startTrim: number;
  endTrim: number;
  /* 사용자가 넣은 꺾임점 (REQ-05) */
  waypoints: Point[];
  /* 클릭 판정용 투명한 굵은 선 */
  hit: SVGPathElement | null;
  label: SVGGElement | null;
  /* 다중성 표기("1", "*") */
  terminals: { el: SVGGElement; end: 'start' | 'end' }[];
}

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; key: string } | null;

/* 콜백 설명은 OverlayLayer.ts의 OverlayCallbacks 참고 */
export interface ClassDiagramOverlayOptions extends OverlayCallbacks {
  /* 선의 시작/끝을 다른 노드에 놓았을 때. 코드의 관계 줄을 바꾸는 일은 호출한 쪽에서 한다. */
  onEdgeReconnect(edgeKey: string, end: 'start' | 'end', nodeId: string): void;
}

/*
 * 클래스 다이어그램용 오버레이.
 * Mermaid가 그린 SVG를 그대로 두고, 그 위에서 노드 위치·크기와 연결선 경로만 바꾼다.
 * - REQ-02: 노드를 끌면 이동, 선택 후 오른쪽 아래 핸들로 크기 조절
 * - REQ-04: 옮긴 노드에 연결된 선은 끝점이 항상 노드 테두리에 붙도록 다시 그린다
 * - REQ-05: 선을 끌면 꺾임점이 생기고, 꺾임점을 끌어 이동, 더블클릭해 삭제 (선 더블클릭으로도 추가)
 * - 선을 선택하면 양 끝에 □ 핸들이 생기고, 끌어서 다른 노드에 놓으면 연결 대상이 바뀐다 (코드도 바뀜)
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
  /* 선택한 선 양 끝의 다시 연결 핸들 */
  private endpointGroup: SVGGElement | null = null;
  /* 다시 연결 중에 그리는 점선과 대상 노드 강조 */
  private reconnectGroup: SVGGElement | null = null;
  private hitGroup: SVGGElement | null = null;
  /* 다시 그려져도 선택을 유지하기 위해 detach 때 지우지 않는다 */
  private selection: Selection = null;
  private cleanups: (() => void)[] = [];
  private frame = 0;
  /* attach 때 받은 모델 값. 드래그 시작 전 값(prev)을 꺼낼 때 쓴다. */
  private savedLayouts: Record<string, NodeLayout> = {};
  private savedPaths: Record<string, Point[]> = {};

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
    this.savedLayouts = layouts;
    this.savedPaths = edgePaths;
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
    this.endpointGroup = this.reconnectGroup = null;
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
          shapes.push({
            el: child,
            original: child.getAttribute('transform'),
            kind: child.classList.contains('divider') ? 'divider' : 'box',
          });
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
    const nodeRects = [...this.nodes.values()].map((node) => ({ id: node.id, rect: layoutRect(node.base) }));
    const found: {
      el: SVGPathElement;
      id: string;
      start: Point;
      end: Point;
      startTrim: number;
      endTrim: number;
      from: string | null;
      to: string | null;
    }[] = [];
    for (const el of root.querySelectorAll<SVGPathElement>('g.edgePaths path[data-id]')) {
      const points = decodeEdgePoints(el.dataset.points);
      if (points.length < 2) continue;
      const start = points[0];
      const end = points[points.length - 1];
      /* data-points의 끝점은 노드 테두리, 실제로 그려진 선은 화살촉 길이만큼 짧다. 그 차이를 재 둔다. */
      const length = el.getTotalLength();
      found.push({
        el,
        id: el.dataset.id!,
        start,
        end,
        startTrim: arrowGap(el.getPointAtLength(0), start),
        endTrim: arrowGap(el.getPointAtLength(length), end),
        from: findAttachedNode(start, nodeRects, EDGE_SNAP_DISTANCE),
        to: findAttachedNode(end, nodeRects, EDGE_SNAP_DISTANCE),
      });
    }

    const keys = assignEdgeKeys(found);
    found.forEach(({ el, id, start, end, startTrim, endTrim, from, to }, index) => {
      const key = keys[index];
      const labelInner = root.querySelector(`g.edgeLabels g.label[data-id="${CSS.escape(id)}"]`);
      const label =
        labelInner?.parentElement instanceof SVGGElement &&
        labelInner.parentElement.classList.contains('edgeLabel')
          ? labelInner.parentElement
          : null;
      this.edges.push({
        el,
        from,
        to,
        key,
        start,
        end,
        startTrim,
        endTrim,
        waypoints: [],
        hit: null,
        label,
        terminals: [],
      });
    });

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

  /* 편집 가능한 선마다 투명한 굵은 선을 깔아 클릭하기 쉽게 한다 (노드보다 아래 층). */
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

    const endpoints = document.createElementNS(SVG_NS, 'g');
    endpoints.classList.add('unidia-endpoints');
    const reconnect = document.createElementNS(SVG_NS, 'g');
    reconnect.classList.add('unidia-reconnect');
    reconnect.setAttribute('pointer-events', 'none');

    group.append(box, handle, waypoints, endpoints, reconnect);
    root.appendChild(group);
    this.overlayGroup = group;
    this.selectionBox = box;
    this.handle = handle;
    this.waypointGroup = waypoints;
    this.endpointGroup = endpoints;
    this.reconnectGroup = reconnect;
  }

  // ── 그리기 ────────────────────────────────────────────────

  private applyNode(node: NodeInfo): void {
    const { x, y, width, height } = node.current;
    node.el.setAttribute('transform', `translate(${x - node.offset.x}, ${y - node.offset.y})`);

    const sx = width / node.base.width;
    const sy = height / node.base.height;
    const resized = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
    /* 크기를 키우면 상자만 커지고, 글자와 칸 구분선은 원래 크기로 왼쪽 위 기준 자리를 지킨다. */
    const shift = contentShift(node.base, node.current);

    for (const shape of node.shapes) {
      if (!resized) {
        setTransform(shape.el, shape.original);
      } else if (shape.kind === 'box') {
        setTransform(shape.el, join(shape.original, `scale(${sx}, ${sy})`));
      } else {
        setTransform(shape.el, join(shape.original, `translate(0, ${-shift.y}) scale(${sx}, 1)`));
      }
    }
    for (const text of node.texts) {
      if (!resized) {
        setTransform(text.el, text.original);
        continue;
      }
      /*
       * REQ-06(폰트 스케일링) 연결 지점: 지금은 글자 크기를 그대로 두고 위치만 옮긴다.
       * 도형 크기에 맞춰 글자를 키우려면 여기서 scale(...)을 덧붙이면 된다.
       */
      const tx = text.base.x - (text.centered ? 0 : shift.x);
      const ty = text.base.y - shift.y;
      text.el.setAttribute('transform', `translate(${tx}, ${ty})`);
    }
  }

  /* 지금 화면에 그려진 선의 전체 경유점 [시작, ...꺾임점, 끝] */
  private currentRoute(edge: EdgeInfo): Point[] | null {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!from || !to || from === to) return null;
    return routeWithWaypoints(layoutRect(from.current), layoutRect(to.current), edge.waypoints);
  }

  /*
   * 선을 다시 그린다. 양 끝 노드가 그대로이고 꺾임점도 없으면 Mermaid가 그린 곡선을 유지하고,
   * 그 밖에는 노드 테두리에서 시작해 꺾임점을 지나는 직선 구간으로 그린다.
   */
  private routeEdge(edge: EdgeInfo): void {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!from || !to || from === to) return; // 자기 자신으로 가는 선은 아직 처리하지 않는다
    if (!from.custom && !to.custom && edge.waypoints.length === 0) return;

    const route = this.currentRoute(edge)!;
    /* 화살촉이 노드에 가려지지 않도록 Mermaid처럼 화살촉 자리만큼 띄워서 그린다 */
    const d = polylinePath(trimRoute(route, edge.startTrim, edge.endTrim));
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

    /* 선 양 끝의 □ 핸들: 끌어서 다른 노드에 놓으면 연결 대상이 바뀐다 */
    this.endpointGroup?.replaceChildren();
    const ends = edge ? this.edgeEnds(edge) : null;
    if (ends) {
      (['start', 'end'] as const).forEach((end, i) => {
        const point = ends[i];
        const square = document.createElementNS(SVG_NS, 'rect');
        square.classList.add('unidia-endpoint');
        square.dataset.unidiaEndpoint = end;
        square.setAttribute('x', String(point.x - ENDPOINT_SIZE / 2));
        square.setAttribute('y', String(point.y - ENDPOINT_SIZE / 2));
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

  /* 선의 양 끝(화살촉 끝) 위치. 다시 그린 선은 계산한 경로의 끝, Mermaid가 그린 선은 원래 끝점. */
  private edgeEnds(edge: EdgeInfo): [Point, Point] | null {
    const from = edge.from ? this.nodes.get(edge.from) : undefined;
    const to = edge.to ? this.nodes.get(edge.to) : undefined;
    if (!edge.key || !from || !to || from === to) return null;
    if (from.custom || to.custom || edge.waypoints.length > 0) {
      const route = this.currentRoute(edge)!;
      return [route[0], route[route.length - 1]];
    }
    return [edge.start, edge.end];
  }

  /* 옮긴 노드·꺾은 선이 잘리지 않도록 보이는 영역(viewBox)을 다이어그램 전체에 맞춘다. */
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

    const endpointEl = target.closest<SVGElement>('[data-unidia-endpoint]');
    const edge = this.selectedEdge();
    if (endpointEl && edge) {
      this.dragEndpoint(e, edge, endpointEl.dataset.unidiaEndpoint === 'start' ? 'start' : 'end');
      return;
    }

    const waypointEl = target.closest<SVGElement>('[data-unidia-waypoint]');
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

  /* 꺾임점 더블클릭 → 삭제, 선 더블클릭 → 그 자리에 꺾임점 추가 */
  private onDoubleClick(e: MouseEvent): void {
    const target = e.target as Element;
    const edge = this.selectedEdge();

    const waypointEl = target.closest<SVGElement>('[data-unidia-waypoint]');
    if (waypointEl && edge?.key) {
      e.preventDefault();
      const index = Number(waypointEl.dataset.unidiaWaypoint);
      const next = edge.waypoints.filter((_, i) => i !== index);
      this.options.onEdgePathCommit(edge.key, next.length > 0 ? next : undefined, this.savedPath(edge.key));
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
      this.options.onEdgePathCommit(key, next, this.savedPath(key));
    }
  }

  private dragNode(e: PointerEvent, id: string, mode: 'move' | 'resize'): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const origin = { ...node.current };
    const wasCustom = node.custom;
    const prev = this.savedLayout(id);

    this.trackPointer(e, {
      move: (dx, dy) => {
        node.current =
          mode === 'move'
            ? { ...origin, x: origin.x + dx, y: origin.y + dy }
            : /* 글자 크기는 그대로이므로 원래 내용 크기보다 작게는 줄이지 않는다 */
              resizeFromBottomRight(origin, dx, dy, node.base.width, node.base.height);
        node.custom = true;
        this.applyNode(node);
        this.rerouteEdgesOf(id);
        this.options.onLayoutPreview(id, { ...node.current });
      },
      commit: () => this.options.onLayoutCommit(id, { ...node.current }, prev),
      cancel: () => {
        node.current = origin;
        node.custom = wasCustom;
        this.applyNode(node);
        this.rerouteEdgesOf(id);
        this.options.onLayoutPreview(id, prev);
      },
    });
  }

  private dragWaypoint(e: PointerEvent, edge: EdgeInfo, index: number): void {
    if (!edge.key || index < 0 || index >= edge.waypoints.length) return;
    const key = edge.key;
    const origin = edge.waypoints.map((p) => ({ ...p }));
    const prev = this.savedPath(key);

    this.trackPointer(e, {
      move: (dx, dy) => {
        edge.waypoints = origin.map((p, i) => (i === index ? { x: p.x + dx, y: p.y + dy } : p));
        this.routeEdge(edge);
        this.options.onEdgePathPreview(key, copyPoints(edge.waypoints));
      },
      commit: () => this.options.onEdgePathCommit(key, copyPoints(edge.waypoints), prev),
      cancel: () => {
        edge.waypoints = origin;
        this.routeEdge(edge);
        this.options.onEdgePathPreview(key, prev);
      },
    });
  }

  /* 선을 잡고 끌면 그 자리에 꺾임점이 생기고 바로 끌려온다. 그냥 클릭이면 선택만 한다. */
  private bendEdge(e: PointerEvent, edge: EdgeInfo): void {
    const route = this.currentRoute(edge);
    if (!edge.key || !route) return;
    const key = edge.key;
    const origin = edge.waypoints.map((p) => ({ ...p }));
    const start = this.toDiagramPoint(e);
    const index = waypointInsertIndex(route, start);
    const prev = this.savedPath(key);

    this.trackPointer(e, {
      move: (dx, dy) => {
        const next = origin.map((p) => ({ ...p }));
        next.splice(index, 0, { x: start.x + dx, y: start.y + dy });
        edge.waypoints = next;
        this.routeEdge(edge);
        this.options.onEdgePathPreview(key, copyPoints(edge.waypoints));
      },
      commit: () => this.options.onEdgePathCommit(key, copyPoints(edge.waypoints), prev),
      cancel: () => {
        edge.waypoints = origin;
        this.routeEdge(edge);
        this.options.onEdgePathPreview(key, prev);
      },
    });
  }

  /*
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

  /* 드래그 시작 전 모델에 저장돼 있던 노드 위치 (처음 옮기는 노드면 undefined) */
  private savedLayout(id: string): NodeLayout | undefined {
    const layout = this.savedLayouts[id];
    return layout ? { ...layout } : undefined;
  }

  /* 편집 전 모델에 저장돼 있던 꺾임점 (처음 꺾는 선이면 undefined) */
  private savedPath(key: string): Point[] | undefined {
    const points = this.savedPaths[key];
    return points ? copyPoints(points) : undefined;
  }

  /*
   * 선 끝 □ 핸들을 끌어 다른 노드에 놓으면 연결 대상을 바꾼다.
   * 끄는 동안은 반대쪽 끝에서 마우스까지 점선을 그리고, 마우스 아래 노드를 초록 테두리로 강조한다.
   * 빈 곳이나 원래 노드에 놓으면 아무것도 바꾸지 않는다.
   */
  private dragEndpoint(e: PointerEvent, edge: EdgeInfo, end: 'start' | 'end'): void {
    const ends = this.edgeEnds(edge);
    if (!edge.key || !ends) return;
    const key = edge.key;
    const [startPoint, endPoint] = ends;
    const fixed = end === 'start' ? endPoint : startPoint;
    const grabbed = end === 'start' ? startPoint : endPoint;
    const currentNode = end === 'start' ? edge.from : edge.to;
    let target: string | null = null;

    this.trackPointer(e, {
      move: (dx, dy) => {
        const cursor = { x: grabbed.x + dx, y: grabbed.y + dy };
        const hovered = this.nodeAt(cursor);
        target = hovered !== currentNode ? hovered : null;
        this.drawReconnect(fixed, cursor, target);
      },
      commit: () => {
        this.reconnectGroup?.replaceChildren();
        if (target) this.options.onEdgeReconnect(key, end, target);
      },
      cancel: () => this.reconnectGroup?.replaceChildren(),
    });
  }

  /* 그 점 위에 있는 노드 (겹치면 나중에 그려진 것) */
  private nodeAt(point: Point): string | null {
    let found: string | null = null;
    for (const node of this.nodes.values()) {
      const rect = layoutRect(node.current);
      const inside =
        point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
      if (inside) found = node.id;
    }
    return found;
  }

  private drawReconnect(from: Point, cursor: Point, target: string | null): void {
    const group = this.reconnectGroup;
    if (!group) return;
    group.replaceChildren();

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(cursor.x));
    line.setAttribute('y2', String(cursor.y));
    line.setAttribute('stroke', ACCENT);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '5 4');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    group.appendChild(line);

    const node = target ? this.nodes.get(target) : undefined;
    if (node) {
      const rect = layoutRect(node.current);
      const margin = 4;
      const highlight = document.createElementNS(SVG_NS, 'rect');
      highlight.setAttribute('x', String(rect.x - margin));
      highlight.setAttribute('y', String(rect.y - margin));
      highlight.setAttribute('width', String(rect.width + margin * 2));
      highlight.setAttribute('height', String(rect.height + margin * 2));
      highlight.setAttribute('fill', 'none');
      highlight.setAttribute('stroke', RECONNECT_COLOR);
      highlight.setAttribute('stroke-width', '2');
      highlight.setAttribute('stroke-dasharray', '4 3');
      highlight.setAttribute('vector-effect', 'non-scaling-stroke');
      group.appendChild(highlight);
    }
  }

  private rerouteEdgesOf(id: string): void {
    for (const edge of this.edges) {
      if (edge.from === id || edge.to === id) this.routeEdge(edge);
    }
  }

  // ── 성능·정확도 측정용 (REQ-04 확인 기준, SRS 3.3 60fps) ─────────

  /* 화면에 있는 노드 이름 목록 */
  nodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /* 노드를 드래그한 것처럼 한 프레임 옮긴다. 모델에는 기록하지 않는다 (측정 후 다시 그리면 원래대로). */
  benchmarkMove(id: string, dx: number, dy: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.current = { ...node.current, x: node.current.x + dx, y: node.current.y + dy };
    node.custom = true;
    this.applyNode(node);
    this.rerouteEdgesOf(id);
  }

  /*
   * 그 노드에 연결된 선들의 끝(화살촉 끝)이 연결된 노드 테두리에서 얼마나 떨어져 있는지(다이어그램 px).
   * 계산값이 아니라 화면에 실제로 그려진 선(path)의 시작·끝점을 읽고, 화살촉 자리만큼 바깥으로 연장해서 잰다.
   */
  endpointErrors(id: string): number[] {
    const errors: number[] = [];
    for (const edge of this.edges) {
      if (edge.from !== id && edge.to !== id) continue;
      const from = edge.from ? this.nodes.get(edge.from) : undefined;
      const to = edge.to ? this.nodes.get(edge.to) : undefined;
      if (!from || !to || from === to) continue;
      const length = edge.el.getTotalLength();
      const start = arrowTip(edge.el, 0, Math.min(1, length), edge.startTrim);
      const end = arrowTip(edge.el, length, Math.max(0, length - 1), edge.endTrim);
      errors.push(distanceToRectBorder(start, layoutRect(from.current)));
      errors.push(distanceToRectBorder(end, layoutRect(to.current)));
    }
    return errors;
  }

  /* 화면 좌표(마우스) → 다이어그램 좌표 */
  private toDiagramPoint(e: MouseEvent): Point {
    const ctm = this.root?.getScreenCTM();
    if (!ctm) return { x: e.clientX, y: e.clientY };
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }
}

/* 그려진 선 끝과 노드 테두리 사이 거리 = 화살촉 자리 (이상하게 크면 화살촉이 아닌 것으로 보고 무시) */
function arrowGap(drawn: DOMPoint, border: Point): number {
  const gap = Math.hypot(drawn.x - border.x, drawn.y - border.y);
  return gap <= MAX_ARROW_GAP ? gap : 0;
}

/* 그려진 선의 끝(at)에서 선 바깥쪽으로 gap만큼 연장한 점 = 화살촉 끝 (inward는 선 안쪽의 가까운 지점) */
function arrowTip(path: SVGPathElement, at: number, inward: number, gap: number): Point {
  const end = path.getPointAtLength(at);
  const inner = path.getPointAtLength(inward);
  const length = Math.hypot(end.x - inner.x, end.y - inner.y);
  if (length === 0 || gap === 0) return { x: end.x, y: end.y };
  return { x: end.x + ((end.x - inner.x) / length) * gap, y: end.y + ((end.y - inner.y) / length) * gap };
}

function copyPoints(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
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