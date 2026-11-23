import type { NodeLayout, Point } from '../core/DiagramModel';

/* 좌상단 기준 사각형 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* 크기까지 정해진 노드 시각 정보 (x, y는 중심) */
export type SizedLayout = Required<NodeLayout>;

/*
 * Mermaid 클래스 노드의 DOM id에서 클래스 이름을 꺼낸다.
 * 예: "unidia-render-0-classId-Animal-0" → "Animal"
 */
export function parseClassNodeId(domId: string): string | null {
  const match = /classId-(.+)-\d+$/.exec(domId);
  return match ? match[1] : null;
}

/* transform 속성의 translate(x, y) 값을 읽는다. 없으면 (0, 0). */
export function parseTranslate(transform: string | null): Point {
  const match = /translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)/.exec(transform ?? '');
  if (!match) return { x: 0, y: 0 };
  return { x: parseFloat(match[1]) || 0, y: parseFloat(match[2] ?? '0') || 0 };
}

/* 중심 좌표 레이아웃 → 좌상단 기준 사각형 */
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

/* 사각형 중심에서 toward 방향으로 그은 선이 사각형 테두리와 만나는 점 */
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

/* 두 노드를 잇는 직선 연결선의 양 끝점 (각 노드 테두리 위) — 마그네틱 커넥터의 기본형 (REQ-04) */
export function straightEdge(from: Rect, to: Rect): [Point, Point] {
  return [rectBorderPoint(from, rectCenter(to)), rectBorderPoint(to, rectCenter(from))];
}

/* 점과 사각형 사이의 거리 (안에 있으면 0) */
export function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/* 점과 사각형 "테두리" 사이의 거리 (안에 있어도 가장 가까운 변까지의 거리). REQ-04 끝점 오차 측정용 */
export function distanceToRectBorder(point: Point, rect: Rect): number {
  const outside = distanceToRect(point, rect);
  if (outside > 0) return outside;
  return Math.min(
    point.x - rect.x,
    rect.x + rect.width - point.x,
    point.y - rect.y,
    rect.y + rect.height - point.y,
  );
}

// ── SVG에서 노드·엣지 식별 (REQ-04 준비) ─────────────────────

/* Mermaid가 연결선의 data-points 속성에 base64 JSON으로 넣어 둔 경유점을 읽는다. 형식이 틀리면 빈 배열. */
export function decodeEdgePoints(encoded: string | undefined): Point[] {
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

/*
 * 연결선 끝점이 어느 노드에 붙어 있는지 찾는다.
 * maxDistance 안에 있는 노드 중 가장 가까운 것, 없으면 null.
 */
export function findAttachedNode(
  point: Point,
  nodes: ReadonlyArray<{ id: string; rect: Rect }>,
  maxDistance: number,
): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance;
  for (const node of nodes) {
    const distance = distanceToRect(point, node.rect);
    if (distance <= bestDistance) {
      best = node.id;
      bestDistance = distance;
    }
  }
  return best;
}

/*
 * 연결선마다 저장용 이름을 붙인다 (같은 두 노드 사이 선은 순번으로 구분).
 * 양 끝 노드를 모르거나 자기 자신으로 가는 선이면 null (편집 대상 아님).
 */
export function assignEdgeKeys(
  ends: ReadonlyArray<{ from: string | null; to: string | null }>,
): (string | null)[] {
  const occurrences = new Map<string, number>();
  return ends.map(({ from, to }) => {
    if (!from || !to || from === to) return null;
    const pair = `${from}->${to}`;
    const n = occurrences.get(pair) ?? 0;
    occurrences.set(pair, n + 1);
    return edgeKey(from, to, n);
  });
}

/*
 * 크기 조절 후 노드 안의 글자를 원래 자리(왼쪽 위 기준)에 두려면 얼마나 옮겨야 하는지.
 * 노드는 중심 기준으로 커지므로, 늘어난 폭·높이의 절반만큼 왼쪽·위로 옮기면 된다.
 */
export function contentShift(
  base: { width: number; height: number },
  current: { width: number; height: number },
): Point {
  return { x: (current.width - base.width) / 2, y: (current.height - base.height) / 2 };
}

/*
 * 화살촉 자리만큼 선의 양 끝을 줄인다.
 * Mermaid는 화살촉 길이만큼 선을 노드에서 띄워 그리고, 그 빈자리에 화살촉을 그려 끝이 노드 테두리에 닿게 한다.
 * 줄이지 않으면 화살촉이 노드 안쪽으로 들어가 노드에 가려진다.
 */
export function trimRoute(route: readonly Point[], startTrim: number, endTrim: number): Point[] {
  const points = route.map((p) => ({ x: p.x, y: p.y }));
  const n = points.length;
  if (n < 2) return points;
  points[0] = moveToward(route[0], route[1], startTrim);
  points[n - 1] = moveToward(route[n - 1], route[n - 2], endTrim);
  return points;
}

/* from에서 to 쪽으로 distance만큼 옮긴 점 (구간 길이의 45%를 넘지 않게: 양 끝을 줄여도 서로 지나치지 않도록) */
function moveToward(from: Point, to: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0 || distance <= 0) return { x: from.x, y: from.y };
  const t = Math.min(distance, length * 0.45) / length;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/*
 * 꺾임점이 있는 연결선의 전체 경유점 (REQ-05).
 * 양 끝점은 각 노드 테두리 위에 두고(REQ-04), 첫·마지막 꺾임점 쪽을 향하게 한다.
 */
export function routeWithWaypoints(from: Rect, to: Rect, waypoints: readonly Point[]): Point[] {
  if (waypoints.length === 0) return straightEdge(from, to);
  const start = rectBorderPoint(from, waypoints[0]);
  const end = rectBorderPoint(to, waypoints[waypoints.length - 1]);
  return [start, ...waypoints.map((p) => ({ ...p })), end];
}

/* 경유점들을 SVG path의 d 속성 문자열로 만든다 (직선 구간). */
export function polylinePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
}

/* 점과 선분 사이의 거리 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/*
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

/* 경유점을 따라 전체 길이의 절반이 되는 지점 (연결선 라벨 위치) */
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

/*
 * 연결선의 저장용 이름. Mermaid의 선 id(id_A_B_1)는 코드에 선이 추가되면 번호가 밀리므로,
 * "어느 노드에서 어느 노드로 가는 몇 번째 선인지"로 이름을 붙여 코드를 고쳐도 유지되게 한다 (REQ-03).
 */
export function edgeKey(from: string, to: string, occurrence: number): string {
  return `${from}->${to}#${occurrence}`;
}

/* 오른쪽 아래 핸들로 크기를 조절한다. 좌상단은 고정되고 최소 크기 아래로는 줄지 않는다. */
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

// ── 시퀀스 다이어그램 ───────────────────────────────────────

/* 기준값(value)에 가장 가까운 항목 이름. maxDistance보다 멀면 null. (예: 메시지 끝 x → 가장 가까운 생명선) */
export function nearestById(
  value: number,
  items: ReadonlyArray<{ id: string; value: number }>,
  maxDistance: number,
): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance;
  for (const item of items) {
    const distance = Math.abs(item.value - value);
    if (distance <= bestDistance) {
      best = item.id;
      bestDistance = distance;
    }
  }
  return best;
}

/*
 * 노트가 어느 참여자의 것인지 찾는다 (참여자를 옮길 때 같이 옮기려고).
 * Mermaid는 "right of X"면 생명선 오른쪽 25px, "left of X"면 왼쪽 25px, "over X"면 생명선 가운데에 노트를 둔다.
 */
export function noteOwner(
  rect: Rect,
  lifelines: ReadonlyArray<{ id: string; x: number }>,
  maxDistance = 40,
): string | null {
  const NOTE_MARGIN = 25;
  let best: string | null = null;
  let bestScore = maxDistance;
  for (const { id, x } of lifelines) {
    const score = Math.min(
      Math.abs(rect.x - x - NOTE_MARGIN), // right of
      Math.abs(rect.x + rect.width - x + NOTE_MARGIN), // left of
      Math.abs(rect.x + rect.width / 2 - x), // over
    );
    if (score <= bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/* 메시지마다 저장용 이름 ("보낸이->받는이#순번"). 자기 자신에게 보내는 메시지도 이름을 붙인다. */
export function assignMessageKeys(
  ends: ReadonlyArray<{ from: string | null; to: string | null }>,
): (string | null)[] {
  const occurrences = new Map<string, number>();
  return ends.map(({ from, to }) => {
    if (!from || !to) return null;
    const pair = `${from}->${to}`;
    const n = occurrences.get(pair) ?? 0;
    occurrences.set(pair, n + 1);
    return edgeKey(from, to, n);
  });
}

/*
 * 메시지를 위아래로 옮길 수 있는 범위. 메시지 순서(=시간 순서)가 바뀌지 않도록
 * 바로 위·아래 메시지와 gap 이상 떨어진 곳까지만 허용한다.
 */
export function messageRange(
  currentY: number,
  otherYs: readonly number[],
  top: number,
  bottom: number,
  gap: number,
): { min: number; max: number } {
  let min = top;
  let max = bottom;
  for (const y of otherYs) {
    if (y <= currentY) min = Math.max(min, y + gap);
    else max = Math.min(max, y - gap);
  }
  return { min, max: Math.max(min, max) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
