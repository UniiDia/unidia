import { describe, expect, it } from 'vitest';
import {
  assignEdgeKeys,
  assignMessageKeys,
  clamp,
  contentShift,
  decodeEdgePoints,
  distanceToRect,
  distanceToRectBorder,
  distanceToSegment,
  edgeKey,
  findAttachedNode,
  insertionIndex,
  messageRange,
  nearestById,
  noteOwner,
  parseClassNodeId,
  parseTranslate,
  pointAtHalfLength,
  polylinePath,
  trimRoute,
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

describe('SVG에서 노드·엣지 식별', () => {
  const encode = (value: unknown) => btoa(JSON.stringify(value));

  it('Mermaid 연결선의 data-points(base64 JSON)를 읽는다', () => {
    const points = [{ x: 79.8, y: 152 }, { x: 79.8, y: 177 }, { x: 79.8, y: 202 }];
    expect(decodeEdgePoints(encode(points))).toEqual(points);
  });

  it('data-points가 없거나 깨졌으면 빈 배열', () => {
    expect(decodeEdgePoints(undefined)).toEqual([]);
    expect(decodeEdgePoints('%%%')).toEqual([]);
    expect(decodeEdgePoints(encode({ x: 1 }))).toEqual([]);
    expect(decodeEdgePoints(encode([{ x: 1, y: 2 }, { x: 'a' }]))).toEqual([{ x: 1, y: 2 }]);
  });

  const nodes = [
    { id: 'Animal', rect: { x: 0, y: 0, width: 100, height: 100 } },
    { id: 'Dog', rect: { x: 0, y: 200, width: 100, height: 50 } },
  ];

  it('선 끝점에서 가장 가까운 노드를 찾는다', () => {
    expect(findAttachedNode({ x: 50, y: 100 }, nodes, 30)).toBe('Animal'); // Animal 아래 테두리
    expect(findAttachedNode({ x: 50, y: 195 }, nodes, 30)).toBe('Dog'); // Dog 위 5px
  });

  it('허용 거리보다 멀면 연결된 노드가 없다', () => {
    expect(findAttachedNode({ x: 500, y: 500 }, nodes, 30)).toBeNull();
  });

  it('같은 두 노드 사이 선은 순번으로 이름을 구분하고, 끝을 모르거나 자기 자신으로 가는 선은 null', () => {
    expect(
      assignEdgeKeys([
        { from: 'A', to: 'B' },
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
        { from: 'A', to: null },
        { from: 'C', to: 'C' },
      ]),
    ).toEqual(['A->B#0', 'A->B#1', 'B->A#0', null, null]);
  });

  it('점과 사각형 테두리 사이 거리 (안쪽이어도 가장 가까운 변까지)', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(distanceToRectBorder({ x: 50, y: 0 }, rect)).toBe(0); // 테두리 위
    expect(distanceToRectBorder({ x: 50, y: 10 }, rect)).toBe(10); // 안쪽 10px
    expect(distanceToRectBorder({ x: 50, y: -3 }, rect)).toBe(3); // 바깥 3px
  });
});

describe('화살촉 자리 띄우기', () => {
  it('시작·끝을 화살촉 길이만큼 안쪽으로 줄인다', () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(trimRoute(route, 17.25, 0)).toEqual([{ x: 17.25, y: 0 }, { x: 100, y: 0 }]);
    expect(trimRoute(route, 0, 6)).toEqual([{ x: 0, y: 0 }, { x: 94, y: 0 }]);
  });

  it('꺾임점이 있으면 첫·마지막 구간 방향으로 줄이고 꺾임점은 그대로 둔다', () => {
    const route = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
    expect(trimRoute(route, 10, 10)).toEqual([{ x: 0, y: 10 }, { x: 0, y: 100 }, { x: 90, y: 100 }]);
  });

  it('구간이 짧아도 양 끝이 서로 지나치지 않는다', () => {
    const [start, end] = trimRoute([{ x: 0, y: 0 }, { x: 20, y: 0 }], 17.25, 17.25);
    expect(start.x).toBeLessThan(end.x);
  });
});

describe('크기 조절 시 글자 위치', () => {
  it('늘어난 폭·높이의 절반만큼 옮기면 글자가 왼쪽 위 기준 자리에 남는다', () => {
    expect(contentShift({ width: 100, height: 60 }, { width: 160, height: 100 })).toEqual({ x: 30, y: 20 });
    expect(contentShift({ width: 100, height: 60 }, { width: 100, height: 60 })).toEqual({ x: 0, y: 0 });
  });
});

describe('시퀀스 다이어그램', () => {
  const lifelines = [
    { id: 'Alice', x: 75 },
    { id: 'Bob', x: 275 },
    { id: 'Carol', x: 475 },
  ];

  it('메시지 끝 x에서 가장 가까운 생명선을 찾는다', () => {
    const items = lifelines.map(({ id, x }) => ({ id, value: x }));
    expect(nearestById(76, items, 30)).toBe('Alice'); // Mermaid는 생명선에서 1px 떨어져 시작
    expect(nearestById(271, items, 30)).toBe('Bob'); // 화살촉 자리만큼 4px 앞에서 끝남
    expect(nearestById(175, items, 30)).toBeNull();
  });

  it('노트 위치로 주인 참여자를 찾는다 (right of / left of / over)', () => {
    expect(noteOwner({ x: 500, y: 0, width: 150, height: 40 }, lifelines)).toBe('Carol'); // right of Carol
    expect(noteOwner({ x: 150, y: 0, width: 100, height: 40 }, lifelines)).toBe('Bob'); // left of Bob
    expect(noteOwner({ x: 0, y: 0, width: 150, height: 40 }, lifelines)).toBe('Alice'); // over Alice
  });

  it('메시지 이름은 보낸이->받는이#순번, 자기 자신에게 보내는 메시지도 포함', () => {
    expect(
      assignMessageKeys([
        { from: 'Alice', to: 'Bob' },
        { from: 'Bob', to: 'Alice' },
        { from: 'Alice', to: 'Bob' },
        { from: 'Carol', to: 'Carol' },
        { from: null, to: 'Bob' },
      ]),
    ).toEqual(['Alice->Bob#0', 'Bob->Alice#0', 'Alice->Bob#1', 'Carol->Carol#0', null]);
  });

  it('메시지는 위·아래 메시지 사이에서만 움직인다 (순서 유지)', () => {
    expect(messageRange(173, [121, 229, 420], 80, 440, 12)).toEqual({ min: 133, max: 217 });
    expect(messageRange(121, [173, 229], 80, 440, 12)).toEqual({ min: 80, max: 161 }); // 첫 메시지
    expect(clamp(300, 133, 217)).toBe(217);
  });

  it('놓은 위치로 새 순서를 구한다 (위에 있는 메시지 개수)', () => {
    const others = [121, 229, 420]; // 나를 뺀 메시지들
    expect(insertionIndex(100, others)).toBe(0); // 맨 앞으로
    expect(insertionIndex(180, others)).toBe(1); // 첫 번째 다음
    expect(insertionIndex(500, others)).toBe(3); // 맨 뒤로
  });
});
