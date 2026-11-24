import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette';
import { recolorSequenceCss } from './svgPalette';

const LIGHT_FILLS = PALETTE.filter((t) => t.text === '#000000').map((t) => t.fill);
const noResolver = () => null;

describe('recolorSequenceCss (시퀀스 기본 상자 색)', () => {
  it('참여자·노트·loop 라벨·활성 막대의 fill을 밝은 토큰으로 바꾼다', () => {
    const css =
      '#m .actor{stroke:hsl(259.6, 59.78%, 87.9%);fill:#ECECFF;}' +
      '#m .note{stroke:#aaaa33;fill:#fff5ad;}' +
      '#m .labelBox{stroke:#9370DB;fill:#ECECFF;}' +
      '#m .activation0{fill:#f4f4f4;stroke:#666;}';
    const out = recolorSequenceCss(css, noResolver);
    const fills = [...out.matchAll(/fill:([^;}]+)/g)].map((m) => m[1]);
    expect(fills).toHaveLength(4);
    for (const f of fills) expect(LIGHT_FILLS).toContain(f);
    // 테두리(stroke)는 그대로
    expect(out).toContain('stroke:hsl(259.6, 59.78%, 87.9%)');
    expect(out).toContain('stroke:#9370DB');
  });

  it('글자·화살표·actor-line 규칙은 건드리지 않는다', () => {
    const css =
      '#m text.actor>tspan{fill:black;stroke:#333;}' +
      '#m .labelText,#m .labelText>tspan{fill:black;}' +
      '#m .actor-line{stroke:#9370DB;fill:#123456;}' +
      '#m [id$="-arrowhead"] path{fill:#333;}';
    expect(recolorSequenceCss(css, noResolver)).toBe(css);
  });

  it('!important는 유지한다', () => {
    const out = recolorSequenceCss('.note{fill:#fff5ad !important;}', noResolver);
    expect(out).toMatch(/^\.note\{fill:#[0-9a-f]{6} !important;\}$/);
  });
});
