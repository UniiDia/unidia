import { describe, expect, it } from 'vitest';
import {
  MIN_DELTA_L,
  PALETTE,
  applyPaletteForExport,
  buildExportColorMap,
  injectPaletteClassDefs,
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

describe('injectPaletteClassDefs', () => {
  it('클래스 다이어그램 끝에 c1~c4 classDef를 붙인다', () => {
    const out = injectPaletteClassDefs('classDiagram\n  class A\n');
    for (const t of PALETTE) expect(out).toContain(`classDef ${t.id} fill:${t.fill}`);
  });

  it('사용자가 정의한 같은 이름은 건너뛰고, 두 번 붙이지 않는다', () => {
    const once = injectPaletteClassDefs('classDiagram\n  class A\n  classDef c1 fill:#000\n');
    expect(once.match(/classDef c1/g)).toHaveLength(1);
    expect(injectPaletteClassDefs(once)).toBe(once);
  });

  it('시퀀스 다이어그램은 그대로 둔다', () => {
    const code = 'sequenceDiagram\n  A->>B: hi\n';
    expect(injectPaletteClassDefs(code)).toBe(code);
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

  it('.mmd 변환과 이미지 변환이 같은 토큰을 고른다', () => {
    const code = 'classDiagram\n  style A fill:#4a148c\n';
    // 이미지 쪽은 노드의 현재 fill에 nearestToken을 쓴다
    const token = nearestToken('#4a148c');
    expect(applyPaletteForExport(code, noResolver)).toContain(`fill:${token?.fill}`);
  });

  it('Mermaid 기본 상자 색(#ECECFF)도 토큰 중 하나로 바뀐다', () => {
    expect(nearestToken('#ececff')).not.toBeNull();
  });

  it('시퀀스: rect/box 색은 밝은 토큰으로', () => {
    const map = buildExportColorMap('sequenceDiagram\n  rect rgb(0, 0, 120)\n  end\n', noResolver);
    expect(['c1', 'c2']).toContain(map.background.get('0,0,120')?.id);
  });
});

describe('applyPaletteForExport', () => {
  it('클래스: style의 fill을 토큰 색으로, color를 토큰 글자색으로', () => {
    const out = applyPaletteForExport(
      'classDiagram\n  class A\n  style A fill:#2e7d32,stroke:#333,color:#000\n',
      noResolver,
    );
    expect(out).toContain('style A fill:#3a7d5c,stroke:#333,color:#ffffff');
  });

  it('클래스: color가 없으면 추가하고, rgb() 안의 쉼표와 끝 세미콜론을 유지한다', () => {
    const out = applyPaletteForExport(
      'classDiagram\n  classDef hot fill:rgb(255, 255, 153),stroke-width:2px;\n',
      noResolver,
    );
    expect(out).toContain('classDef hot fill:#fff2b3,stroke-width:2px,color:#000000;');
  });

  it('클래스: 읽을 수 없는 색과 none은 그대로 둔다', () => {
    const code = 'classDiagram\n  style A fill:none\n  style B fill:red\n';
    const out = applyPaletteForExport(code, noResolver);
    expect(out).toContain('style A fill:none');
    expect(out).toContain('style B fill:red');
  });

  it('클래스: resolver로 색 이름도 변환한다', () => {
    const out = applyPaletteForExport('classDiagram\n  style A fill:navy\n', {
      resolveColor: (c) => (c === 'navy' ? '#000080' : null),
    });
    expect(out).toMatch(/style A fill:#(7fb2e5|5b2147)/);
  });

  it('시퀀스: rect/box 색을 밝은 토큰의 rgb()로', () => {
    const out = applyPaletteForExport(
      'sequenceDiagram\n  box rgb(0, 0, 120) Backend\n  participant A\n  end\n  rect rgba(255, 255, 0, 0.3)\n  A->>A: hi\n  end\n',
      noResolver,
    );
    expect(out).toMatch(/box rgb\((255, 242, 179|127, 178, 229)\) Backend/);
    expect(out).toContain('rect rgb(255, 242, 179)');
  });

  it('시퀀스: 색 없이 제목만 있는 box와 transparent는 그대로 둔다', () => {
    const code = 'sequenceDiagram\n  box Backend\n  end\n  box transparent Front\n  end\n';
    expect(applyPaletteForExport(code, noResolver)).toBe(code);
  });
});
