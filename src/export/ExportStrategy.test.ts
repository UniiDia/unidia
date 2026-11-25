import { describe, expect, it } from 'vitest';
import { ExportSizeError, MermaidCodeExport, RasterImageExport, computeExportSize } from './ExportStrategy';

describe('MermaidCodeExport (.mmd)', () => {
  it('작성한 코드를 그대로 내보낸다 (팔레트 주석·classDef·색 변환 없음)', async () => {
    const code = 'classDiagram\n  class Dog\n  style Dog fill:#4a148c\n';
    const blob = await new MermaidCodeExport().export({ svg: '<svg></svg>', code, colorMode: 'grayscale' });
    expect(await blob.text()).toBe(code);
  });
});

describe('RasterImageExport', () => {
  it('다이어그램이 없으면 색상 선택 창을 띄우기 전에 오류를 낸다', async () => {
    await expect(new RasterImageExport('png', 'png', 'image/png').export({ svg: ' ', code: '' })).rejects.toThrow(
      '내보낼 다이어그램이 없습니다',
    );
  });
});

/** REQ-08 기준(잠정): 이미지 폭 2000px 이상 */
const MIN_WIDTH = 2000;
/** ExportStrategy.ts의 canvas 한계와 같은 값 */
const MAX_SIDE = 16384;
const MAX_AREA = 268_435_456;

describe('computeExportSize (REQ-08 해상도)', () => {
  it('작은 다이어그램은 폭 2000px로 키운다', () => {
    const size = computeExportSize(500, 300, MIN_WIDTH);
    expect(size).toEqual({ width: 2000, height: 1200, scale: 4 });
  });

  it('가로세로 비율을 유지한다', () => {
    const { width, height } = computeExportSize(640, 480, MIN_WIDTH);
    expect(width).toBe(2000);
    expect(width / height).toBeCloseTo(640 / 480, 2);
  });

  it('이미 2000px 이상이면 줄이지 않고 원래 크기(배율 1)로 둔다', () => {
    expect(computeExportSize(3000, 1000, MIN_WIDTH)).toEqual({ width: 3000, height: 1000, scale: 1 });
  });

  it('정확히 2000px이면 그대로 둔다', () => {
    expect(computeExportSize(2000, 800, MIN_WIDTH)).toEqual({ width: 2000, height: 800, scale: 1 });
  });

  it('나누어 떨어지지 않는 폭도 반올림 후 2000px 이상이 된다', () => {
    for (const w of [333, 777, 1234, 1999]) {
      expect(computeExportSize(w, 100, MIN_WIDTH).width).toBeGreaterThanOrEqual(MIN_WIDTH);
    }
  });

  it('최소 폭을 다르게 지정할 수 있다', () => {
    expect(computeExportSize(250, 100, 1000)).toEqual({ width: 1000, height: 400, scale: 4 });
  });

  it('결과는 canvas 한 변·면적 한계를 넘지 않는다', () => {
    const cases: Array<[number, number]> = [
      [500, 300],
      [3000, 1000],
      [200, 1500],
      [16384, 16384],
      [20000, 20000],
      [30000, 10000],
    ];
    for (const [w, h] of cases) {
      const { width, height } = computeExportSize(w, h, MIN_WIDTH);
      expect(width).toBeLessThanOrEqual(MAX_SIDE);
      expect(height).toBeLessThanOrEqual(MAX_SIDE);
      expect(width * height).toBeLessThanOrEqual(MAX_AREA);
    }
  });

  it('canvas보다 큰 다이어그램은 한계에 맞춰 줄이되, 폭이 2000px 이상이면 허용한다', () => {
    const size = computeExportSize(30000, 10000, MIN_WIDTH);
    expect(size.width).toBe(MAX_SIDE);
    expect(size.scale).toBeLessThan(1);
    expect(size.width).toBeGreaterThanOrEqual(MIN_WIDTH);
  });

  it('세로로 너무 긴 다이어그램은 ExportSizeError를 던진다 (기준 미달 이미지를 내보내지 않음)', () => {
    // 폭을 2000px로 키우려면 세로가 20000px → 한계(16384px) 초과
    expect(() => computeExportSize(500, 5000, MIN_WIDTH)).toThrow(ExportSizeError);
  });

  it('ExportSizeError에 요구 폭과 가능한 최대 폭이 담긴다', () => {
    try {
      computeExportSize(500, 5000, MIN_WIDTH);
      expect.unreachable('ExportSizeError가 발생해야 합니다');
    } catch (error) {
      expect(error).toBeInstanceOf(ExportSizeError);
      const e = error as ExportSizeError;
      expect(e.name).toBe('ExportSizeError');
      expect(e.minWidth).toBe(MIN_WIDTH);
      // 세로가 16384px가 되는 배율(16384 / 5000)에서의 폭
      expect(e.maxWidth).toBe(Math.round(500 * (MAX_SIDE / 5000)));
      expect(e.maxWidth).toBeLessThan(MIN_WIDTH);
    }
  });

  it('경계: 세로가 한계에 딱 맞으면 통과한다', () => {
    // 500 × 4096 → 배율 4 → 2000 × 16384
    expect(computeExportSize(500, 4096, MIN_WIDTH)).toEqual({ width: 2000, height: 16384, scale: 4 });
  });

  it('경계: 세로가 한계를 조금만 넘어도 오류', () => {
    expect(() => computeExportSize(500, 4100, MIN_WIDTH)).toThrow(ExportSizeError);
  });
});
