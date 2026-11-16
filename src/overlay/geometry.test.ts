import { describe, expect, it } from 'vitest';
import {
  distanceToRect,
  parseClassNodeId,
  parseTranslate,
  rectBorderPoint,
  resizeFromBottomRight,
  straightEdge,
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
