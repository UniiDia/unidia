import { describe, expect, it } from 'vitest';
import {
  MIN_DELTA_L,
  PALETTE,
  buildExportColorMap,
  lightnessOf,
  minPairwiseDeltaL,
  nearestToken,
  parseColor,
} from './palette';

const noResolver = { resolveColor: () => null };

describe('REQ-09 팔레트', () => {
  it('4색 중 어느 두 색도 L* 차이가 20 이상이다', () => {
    expect(PALETTE).toHaveLength(4);
    expect(minPairwiseDeltaL(PALETTE.map((t) => t.fill))).toBeGreaterThanOrEqual(MIN_DELTA_L);
  });

  it('글자색이 채움색과 충분히 대비된다 (L* 차이 50 이상)', () => {
    for (const t of PALETTE) {
      expect(Math.abs(lightnessOf(t.fill) - lightnessOf(t.text))).toBeGreaterThanOrEqual(50);
    }
  });

  it('흰색 100, 검정 0', () => {
    expect(lightnessOf('#ffffff')).toBeCloseTo(100, 1);
    expect(lightnessOf('#000')).toBeCloseTo(0, 1);
  });
});

describe('parseColor', () => {
  it('hex, rgb(), hsl()을 읽는다', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('rgb(0, 128, 255)')).toEqual({ r: 0, g: 128, b: 255 });
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('알파는 흰 배경 위에 합성한다', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it('색 이름은 null (브라우저 resolver가 처리)', () => {
    expect(parseColor('red')).toBeNull();
  });
});

describe('nearestToken', () => {
  it('토큰 색 자신은 자기 자신으로', () => {
    for (const t of PALETTE) expect(nearestToken(t.fill)?.id).toBe(t.id);
  });

  it('비슷한 색은 가까운 토큰으로', () => {
    expect(nearestToken('#ffff99')?.id).toBe('c1'); // 연노랑
    expect(nearestToken('#6fa8dc')?.id).toBe('c2'); // 하늘
    expect(nearestToken('#2e7d32')?.id).toBe('c3'); // 초록
    expect(nearestToken('#4a148c')?.id).toBe('c4'); // 진보라
  });

  it('darkTextOnly면 밝은 토큰만 쓴다', () => {
    expect(['c1', 'c2']).toContain(nearestToken('#4a148c', { darkTextOnly: true })?.id);
  });
});

describe('buildExportColorMap (이미지 변환용)', () => {
  it('클래스: classDef 이름을 토큰에 대응시킨다', () => {
    const map = buildExportColorMap(
      'classDiagram\n  classDef hot,warm fill:rgb(255, 255, 153)\n  classDef dark fill:#2e7d32\n',
      noResolver,
    );
    expect(map.byClass.get('hot')?.id).toBe('c1');
    expect(map.byClass.get('warm')?.id).toBe('c1');
    expect(map.byClass.get('dark')?.id).toBe('c3');
  });

  it('클래스: 읽을 수 없는 색과 none은 대응표에 넣지 않는다', () => {
    const map = buildExportColorMap('classDiagram\n  classDef a fill:none\n  classDef b fill:red\n', noResolver);
    expect(map.byClass.size).toBe(0);
  });

  it('클래스: resolver로 색 이름도 해석한다', () => {
    const map = buildExportColorMap('classDiagram\n  classDef deep fill:navy\n', {
      resolveColor: (c) => (c === 'navy' ? '#000080' : null),
    });
    expect(map.byClass.get('deep')).toBeDefined();
  });

  it('Mermaid 기본 상자 색(#ECECFF)도 토큰 중 하나로 바뀐다', () => {
    expect(nearestToken('#ececff')).not.toBeNull();
  });

  it('시퀀스: rect/box 색은 밝은 토큰으로', () => {
    const map = buildExportColorMap('sequenceDiagram\n  rect rgb(0, 0, 120)\n  end\n', noResolver);
    expect(['c1', 'c2']).toContain(map.background.get('0,0,120')?.id);
  });

  it('시퀀스: box 색과 알파가 있는 rect 색도 대응표에 넣는다', () => {
    const map = buildExportColorMap(
      'sequenceDiagram\n  box rgb(0, 0, 120) Backend\n  end\n  rect rgba(255, 255, 0, 0.3)\n  end\n',
      noResolver,
    );
    expect(map.background.has('0,0,120')).toBe(true);
    expect(map.background.get('255,255,179')?.id).toBe('c1'); // 흰 배경 위에 합성한 색
  });

  it('시퀀스: 색 없이 제목만 있는 box와 transparent는 넣지 않는다', () => {
    const map = buildExportColorMap(
      'sequenceDiagram\n  box Backend\n  end\n  box transparent Front\n  end\n',
      noResolver,
    );
    expect(map.background.size).toBe(0);
  });
});
