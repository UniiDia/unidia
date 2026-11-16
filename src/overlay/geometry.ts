import type { NodeLayout, Point } from '../core/DiagramModel';

/** 좌상단 기준 사각형 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 크기까지 정해진 노드 시각 정보 (x, y는 중심) */
export type SizedLayout = Required<NodeLayout>;

/**
 * Mermaid 클래스 노드의 DOM id에서 클래스 이름을 꺼낸다.
 * 예: "unidia-render-0-classId-Animal-0" → "Animal"
 */
export function parseClassNodeId(domId: string): string | null {
  const match = /classId-(.+)-\d+$/.exec(domId);
  return match ? match[1] : null;
}

/** transform 속성의 translate(x, y) 값을 읽는다. 없으면 (0, 0). */
export function parseTranslate(transform: string | null): Point {
  const match = /translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)/.exec(transform ?? '');
  if (!match) return { x: 0, y: 0 };
  return { x: parseFloat(match[1]) || 0, y: parseFloat(match[2] ?? '0') || 0 };
}

/** 중심 좌표 레이아웃 → 좌상단 기준 사각형 */
export function layoutRect(layout: SizedLayout): Rect {
  return {
    x: layout.x - layout.width / 2,
    y: layout.y - layout.height / 2,
    width: layout.width,
    height: layout.height,
  };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 사각형 중심에서 toward 방향으로 그은 선이 사각형 테두리와 만나는 점 */
export function rectBorderPoint(rect: Rect, toward: Point): Point {
  const center = rectCenter(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const tx = dx !== 0 ? rect.width / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? rect.height / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

/** 두 노드를 잇는 직선 연결선의 양 끝점 (각 노드 테두리 위) — 마그네틱 커넥터의 기본형 (REQ-04) */
export function straightEdge(from: Rect, to: Rect): [Point, Point] {
  return [rectBorderPoint(from, rectCenter(to)), rectBorderPoint(to, rectCenter(from))];
}

/** 점과 사각형 사이의 거리 (안에 있으면 0) */
export function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * 꺾임점이 있는 연결선의 전체 경유점 (REQ-05).
 * 양 끝점은 각 노드 테두리 위에 두고(REQ-04), 첫·마지막 꺾임점 쪽을 향하게 한다.
 */
export function routeWithWaypoints(from: Rect, to: Rect, waypoints: readonly Point[]): Point[] {
  if (waypoints.length === 0) return straightEdge(from, to);
  const start = rectBorderPoint(from, waypoints[0]);
  const end = rectBorderPoint(to, waypoints[waypoints.length - 1]);
  return [start, ...waypoints.map((p) => ({ ...p })), end];
}

/** 경유점들을 SVG path의 d 속성 문자열로 만든다 (직선 구간). */
export function polylinePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
}

/** 점과 선분 사이의 거리 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * 선 위의 점 p에 꺾임점을 새로 넣을 때, 꺾임점 배열의 몇 번째에 넣어야 하는지.
 * route는 [시작점, ...꺾임점, 끝점] 전체 경유점이다. p에 가장 가까운 구간 i에 넣으면
 * 꺾임점 배열 기준 위치도 i가 된다.
 */
export function waypointInsertIndex(route: readonly Point[], p: Point): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const distance = distanceToSegment(p, route[i], route[i + 1]);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** 경유점을 따라 전체 길이의 절반이 되는 지점 (연결선 라벨 위치) */
export function pointAtHalfLength(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= lengths[i];
  }
  return { ...points[points.length - 1] };
}

/**
 * 연결선의 저장용 이름. Mermaid의 선 id(id_A_B_1)는 코드에 선이 추가되면 번호가 밀리므로,
 * "어느 노드에서 어느 노드로 가는 몇 번째 선인지"로 이름을 붙여 코드를 고쳐도 유지되게 한다 (REQ-03).
 */
export function edgeKey(from: string, to: string, occurrence: number): string {
  return `${from}->${to}#${occurrence}`;
}

/** 오른쪽 아래 핸들로 크기를 조절한다. 좌상단은 고정되고 최소 크기 아래로는 줄지 않는다. */
export function resizeFromBottomRight(
  origin: SizedLayout,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
): SizedLayout {
  const left = origin.x - origin.width / 2;
  const top = origin.y - origin.height / 2;
  const width = Math.max(minWidth, origin.width + dx);
  const height = Math.max(minHeight, origin.height + dy);
  return { x: left + width / 2, y: top + height / 2, width, height };
}
