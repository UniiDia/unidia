import { describe, expect, it } from 'vitest';
import { chooseClearDirection, makeBenchmarkCode, summarizeFrames } from './benchmark';

describe('성능 측정 도우미', () => {
  it('측정용 다이어그램은 클래스 30개와 연결선 34개로 만든다', () => {
    const code = makeBenchmarkCode(30);
    expect(code.startsWith('classDiagram')).toBe(true);
    expect(code.match(/^\s+class C\d+ \{$/gm)).toHaveLength(30);
    expect(code.match(/-->|<\|--/g)).toHaveLength(34); // 사슬 29개 + 상속 5개
  });

  it('프레임 간격으로 평균·최저 fps를 구한다', () => {
    const frames = [...Array(19).fill(16), 32]; // 한 프레임만 느림
    const summary = summarizeFrames(frames);
    expect(summary.minFps).toBe(31.3); // 1000 / 32
    expect(summary.avgFps).toBe(59.5); // 1000 / 16.8
    expect(summary.p95FrameMs).toBe(16);
  });

  it('프레임이 없으면 0', () => {
    expect(summarizeFrames([])).toEqual({ avgFps: 0, minFps: 0, p95FrameMs: 0 });
  });

  it('옮긴 뒤 다른 노드와 겹치거나 붙지 않는 방향을 고른다', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    const blockerBelow = { x: 0, y: 100, width: 100, height: 50 }; // 아래쪽에 다른 노드
    const sequence = [0.25, 0.75]; // 첫 시도: 아래(90°) → 막힘, 둘째: 위(270°) → 통과
    let i = 0;
    const result = chooseClearDirection(rect, [blockerBelow], 90, () => sequence[i++ % sequence.length]);
    expect(result.clear).toBe(true);
    expect(result.angle).toBeCloseTo(Math.PI * 1.5);
  });

  it('어느 방향도 안 되면 clear: false', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    const around = [{ x: -500, y: -500, width: 1100, height: 1050 }]; // 사방이 막힘
    expect(chooseClearDirection(rect, around, 90, () => 0.1).clear).toBe(false);
  });
});
