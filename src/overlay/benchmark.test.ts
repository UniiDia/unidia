import { describe, expect, it } from 'vitest';
import { makeBenchmarkCode, summarizeFrames } from './benchmark';

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
});
