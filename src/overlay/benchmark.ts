import type { ClassDiagramOverlay } from './ClassDiagramOverlay';

/*
 * 오버레이 성능·정확도 측정 (SRS 3.3 "노드 30개에서 드래그 60fps", REQ-04 "끝점이 노드 경계에서 1px 이내").
 * 사용법: 개발 서버 주소 끝에 ?bench 를 붙여 열고(예: http://localhost:5173/?bench) [성능 측정] 버튼을 누른다.
 */

export interface BenchmarkResult {
  nodes: number;
  moves: number;
  frames: number;
  /* 실제 화면 갱신 기준 평균·최저 fps (모니터 주사율이 상한) */
  avgFps: number;
  minFps: number;
  /* 가장 느린 5% 프레임의 길이 (ms) */
  p95FrameMs: number;
  /* 오버레이 코드가 한 프레임에 쓴 시간 (ms, 브라우저 그리기 시간 제외) */
  avgWorkMs: number;
  maxWorkMs: number;
  endpointChecks: number;
  maxEndpointErrorPx: number;
  /* 측정 중 탭이 보이고 있었는지 (숨겨진 탭은 브라우저가 화면 갱신을 늦춰 fps가 의미 없다) */
  pageVisible: boolean;
  passFps: boolean;
  passEndpoint: boolean;
}

/* 합격 기준: 평균 55fps 이상(SRS 3.3 잠정), 끝점 오차 1px 이내(REQ-04 잠정) */
export const FPS_TARGET = 55;
export const ENDPOINT_TOLERANCE_PX = 1;

/* 측정용 클래스 다이어그램: 클래스 n개를 사슬로 잇고, 5개마다 상속 관계를 하나씩 더한다. */
export function makeBenchmarkCode(nodeCount = 30): string {
  const lines = ['classDiagram'];
  for (let i = 1; i <= nodeCount; i++) {
    lines.push(`  class C${i} {`, `    +int field${i}`, `    +method${i}()`, '  }');
  }
  for (let i = 1; i < nodeCount; i++) lines.push(`  C${i} --> C${i + 1}`);
  for (let i = 1; i + 5 <= nodeCount; i += 5) lines.push(`  C${i} <|-- C${i + 5}`);
  return `${lines.join('\n')}\n`;
}

/* 프레임 간격(ms) 목록 → 평균·최저 fps, 느린 5% 프레임 길이 */
export function summarizeFrames(frameMs: readonly number[]): {
  avgFps: number;
  minFps: number;
  p95FrameMs: number;
} {
  const valid = frameMs.filter((ms) => ms > 0);
  if (valid.length === 0) return { avgFps: 0, minFps: 0, p95FrameMs: 0 };
  const average = valid.reduce((sum, ms) => sum + ms, 0) / valid.length;
  const sorted = [...valid].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    avgFps: round(1000 / average, 1),
    minFps: round(1000 / sorted[sorted.length - 1], 1),
    p95FrameMs: round(p95, 2),
  };
}

/* 조건이 참이 될 때까지 기다린다 (최대 timeoutMs). */
export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const startedAt = performance.now();
  while (!condition()) {
    if (performance.now() - startedAt > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/*
 * 노드를 무작위로 골라 무작위 방향으로 끄는 동작을 moves번 흉내 낸다.
 * 한 번 끌 때 framesPerMove 프레임 동안 stepPx씩 옮기며 프레임 간격을 재고,
 * 다 끈 뒤에는 그 노드에 붙은 선의 끝점이 노드 테두리에서 얼마나 떨어졌는지 잰다.
 */
export async function runOverlayBenchmark(
  overlay: ClassDiagramOverlay,
  options: { moves?: number; framesPerMove?: number; stepPx?: number; random?: () => number } = {},
): Promise<BenchmarkResult> {
  const { moves = 20, framesPerMove = 15, stepPx = 6, random = Math.random } = options;
  const ids = overlay.nodeIds();
  if (ids.length === 0) throw new Error('측정할 노드가 없습니다');

  const frameMs: number[] = [];
  const workMs: number[] = [];
  let endpointChecks = 0;
  let maxEndpointError = 0;
  let pageVisible = document.visibilityState === 'visible';

  let last = await nextFrame();
  for (let move = 0; move < moves; move++) {
    const id = ids[Math.floor(random() * ids.length)];
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle) * stepPx;
    const dy = Math.sin(angle) * stepPx;

    for (let frame = 0; frame < framesPerMove; frame++) {
      const before = performance.now();
      overlay.benchmarkMove(id, dx, dy);
      workMs.push(performance.now() - before);
      const now = await nextFrame();
      frameMs.push(now - last);
      last = now;
    }

    for (const error of overlay.endpointErrors(id)) {
      endpointChecks++;
      maxEndpointError = Math.max(maxEndpointError, error);
    }
    pageVisible &&= document.visibilityState === 'visible';
  }

  const frames = summarizeFrames(frameMs);
  const maxEndpointErrorPx = round(maxEndpointError, 3);
  return {
    nodes: ids.length,
    moves,
    frames: frameMs.length,
    ...frames,
    avgWorkMs: round(workMs.reduce((sum, ms) => sum + ms, 0) / workMs.length, 3),
    maxWorkMs: round(Math.max(...workMs), 3),
    endpointChecks,
    maxEndpointErrorPx,
    pageVisible,
    passFps: frames.avgFps >= FPS_TARGET,
    passEndpoint: maxEndpointErrorPx <= ENDPOINT_TOLERANCE_PX,
  };
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
