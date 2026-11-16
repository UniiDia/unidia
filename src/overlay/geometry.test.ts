import { describe, expect, it } from 'vitest';
import {
  distanceToRect,
  distanceToSegment,
  edgeKey,
  parseClassNodeId,
  parseTranslate,
  pointAtHalfLength,
  polylinePath,
  rectBorderPoint,
  resizeFromBottomRight,
  routeWithWaypoints,
  straightEdge,
  waypointInsertIndex,
} from './geometry';

describe('overlay geometry', () => {
  it('Mermaid 노드 id에서 클래스 이름을 꺼낸다', () => {
    expect(parseClassNodeId('unidia-render-0-classId-Animal-0')).toBe('Animal');
    expect(parseClassNodeId('unidia-render-3-classId-Owner_X-12')).toBe('Owner_X');
    expect(parseClassNodeId('flowchart-A-1')).toBeNull();
  });

  it('translate 값을 읽는다', () => {
    expect(parseTranslate('translate(79.82, 80)')).toEqual({ x: 79.82, y: 80 });
    expect(parseTranslate('translate(0,-12)')).toEqual({ x: 0, y: -12 });
    expect(parseTranslate(null)).toEqual({ x: 0, y: 0 });
  });

  it('사각형 테두리와 만나는 점을 구한다', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(rectBorderPoint(rect, { x: 200, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(rectBorderPoint(rect, { x: 50, y: -100 })).toEqual({ x: 50, y: 0 });
  });

  it('두 노드를 테두리끼리 잇는 직선을 만든다', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 0, y: 200, width: 100, height: 100 };
    expect(straightEdge(a, b)).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
    ]);
  });

  it('점과 사각형 사이 거리를 구한다', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(distanceToRect({ x: 5, y: 5 }, rect)).toBe(0);
    expect(distanceToRect({ x: 13, y: 14 }, rect)).toBe(5);
  });

  it('크기 조절 시 좌상단은 고정되고 최소 크기를 지킨다', () => {
    const origin = { x: 50, y: 50, width: 100, height: 100 };
    expect(resizeFromBottomRight(origin, 20, 10, 40, 30)).toEqual({ x: 60, y: 55, width: 120, height: 110 });
    expect(resizeFromBottomRight(origin, -500, -500, 40, 30)).toEqual({ x: 20, y: 15, width: 40, height: 30 });
  });
});

describe('엣지 꺾임점 (REQ-05)', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }; // 중심 (50, 50)
  const b = { x: 300, y: 0, width: 100, height: 100 }; // 중심 (350, 50)

  it('꺾임점이 없으면 직선 연결과 같다', () => {
    expect(routeWithWaypoints(a, b, [])).toEqual(straightEdge(a, b));
  });

  it('꺾임점이 있으면 양 끝은 노드 테두리, 가운데는 꺾임점을 지난다 (REQ-04 유지)', () => {
    const route = routeWithWaypoints(a, b, [{ x: 50, y: 200 }, { x: 350, y: 200 }]);
    expect(route).toEqual([
      { x: 50, y: 100 }, // A의 아래 테두리
      { x: 50, y: 200 },
      { x: 350, y: 200 },
      { x: 350, y: 100 }, // B의 아래 테두리
    ]);
  });

  it('경유점으로 path 문자열을 만든다', () => {
    expect(polylinePath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }])).toBe('M0,0L10,5L20,0');
  });

  it('점과 선분 사이 거리를 구한다', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('가장 가까운 구간에 꺾임점을 넣는다', () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(waypointInsertIndex(route, { x: 50, y: 2 })).toBe(0); // 첫 구간 → 맨 앞
    expect(waypointInsertIndex(route, { x: 98, y: 60 })).toBe(1); // 둘째 구간 → 기존 꺾임점 뒤
  });

  it('선 전체 길이의 절반 지점을 구한다 (라벨 위치)', () => {
    expect(pointAtHalfLength([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toEqual({ x: 100, y: 0 });
    expect(pointAtHalfLength([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
  });

  it('연결선 이름은 양 끝 노드와 순번으로 정한다', () => {
    expect(edgeKey('Animal', 'Dog', 0)).toBe('Animal->Dog#0');
  });
});
