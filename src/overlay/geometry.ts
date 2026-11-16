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
