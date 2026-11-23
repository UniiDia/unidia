import {
  browserColorResolver,
  buildExportColorMap,
  colorKey,
  nearestToken,
  tokenById,
  type ColorResolver,
  type ExportColorMap,
  type PaletteToken,
} from './palette';

/**
 * REQ-09: 화면에 렌더링된 Mermaid SVG의 색을 내보내기용 팔레트 색으로 바꾼다.
 * Mermaid를 다시 호출하지 않고, 넘겨받은 SVG만 고친다.
 *
 * Mermaid 11 출력 구조에 기대는 부분 (버전이 바뀌면 확인 필요)
 * - 클래스 노드는 <g class="node ..."> 이고, 노드의 cssClasses(classDef 이름 등)가 class 속성에 붙는다.
 * - style/classDef 색은 노드 안 도형(path 등)의 fill 속성·inline style, 글자색은 span의 inline style로 들어간다.
 * - 시퀀스의 rect/box 배경은 <rect fill="색">으로 그려진다.
 *
 * 범위를 노드(g.node)와 배경 rect로 한정해서, 선·화살표·글자처럼 같은 색을 쓰는 다른 요소는 건드리지 않는다.
 */
export function applyPaletteToSvg(
  svg: SVGSVGElement,
  code: string,
  resolve: ColorResolver = browserColorResolver,
): void {
  const map = buildExportColorMap(code, { resolveColor: resolve });
  recolorClassNodes(svg, map, resolve);
  recolorBackgrounds(svg, map, resolve);
  for (const style of Array.from(svg.querySelectorAll('style'))) {
    style.textContent = recolorSequenceCss(style.textContent ?? '', resolve);
  }
}

/**
 * 시퀀스 다이어그램 기본 상자(참여자·노트·loop 라벨·활성 막대)의 색은 Mermaid가 <style>의 CSS 규칙으로 넣는다.
 * 해당 규칙의 fill만 가장 가까운 토큰으로 바꾼다.
 * 상자 위 글자색은 테마 그대로(어두운 색)이므로 글자색이 검정인 밝은 토큰(c1, c2)만 쓴다.
 * 글자 규칙(text.actor > tspan 등)은 건드리지 않는다.
 */
const SEQUENCE_BOX_CLASS = /\.(actor|note|labelBox|activation\d)(?![\w-])/;

export function recolorSequenceCss(css: string, resolve?: ColorResolver): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    const parts = selector.split(',');
    const isBox = parts.some((p) => SEQUENCE_BOX_CLASS.test(p) && !/\b(text|tspan)\b/.test(p));
    if (!isBox) return rule;
    const newBody = body.replace(
      /(^|;)(\s*fill\s*:\s*)([^;!}]+?)(\s*(?:!important)?\s*)(?=;|$)/g,
      (decl, lead: string, prop: string, color: string, tail: string) => {
        const token = nearestToken(color.trim(), { darkTextOnly: true }) ?? resolveNearest(color, resolve);
        return token ? `${lead}${prop}${token.fill}${tail}` : decl;
      },
    );
    return `${selector}{${newBody}}`;
  });
}

function resolveNearest(color: string, resolve?: ColorResolver): PaletteToken | null {
  const hex = resolve?.(color.trim());
  return hex ? nearestToken(hex, { darkTextOnly: true }) : null;
}

const SHAPES = 'path, rect, polygon, ellipse, circle';
const HTML_TEXT = 'foreignObject span, foreignObject div, foreignObject p';
const SVG_TEXT = 'text, tspan';

function recolorClassNodes(svg: SVGSVGElement, map: ExportColorMap, resolve?: ColorResolver): void {
  for (const node of Array.from(svg.querySelectorAll('g.node'))) {
    const token = tokenForNode(node, map, resolve);
    if (!token) continue;

    for (const shape of Array.from(node.querySelectorAll(SHAPES))) {
      // 테두리 전용 도형(fill="none")은 그대로 둔다.
      if (!hasVisibleFill(shape)) continue;
      setFill(shape, token.fill);
    }
    for (const el of Array.from(node.querySelectorAll(HTML_TEXT))) {
      setStyle(el, 'color', token.text);
    }
    for (const el of Array.from(node.querySelectorAll(SVG_TEXT))) {
      setFill(el, token.text);
    }
  }
}

/**
 * 노드에 적용할 토큰을 정한다. 우선순위:
 * 1) 사용자 classDef 이름이 붙은 노드 (classDef 정의가 CSS로만 들어가도 잡히도록)
 * 2) 팔레트 토큰 이름(c1~c4)이 붙은 노드 — 사용자가 같은 이름을 정의하지 않은 경우
 * 3) 그 밖의 모든 노드: 도형의 현재 fill(사용자 style 색 또는 Mermaid 기본 상자 색)에 가장 가까운 토큰
 */
function tokenForNode(node: Element, map: ExportColorMap, resolve?: ColorResolver): PaletteToken | null {
  const classes = Array.from(node.classList);
  for (const name of classes) {
    const token = map.byClass.get(name);
    if (token) return token;
  }
  for (const name of classes) {
    const token = tokenById(name);
    if (token) return token;
  }
  for (const shape of Array.from(node.querySelectorAll(SHAPES))) {
    if (!hasVisibleFill(shape)) continue;
    const fill = readFill(shape)!.trim();
    const token = nearestToken(fill) ?? (resolve ? nearestToken(resolve(fill) ?? '') : null);
    if (token) return token;
  }
  return null;
}

function recolorBackgrounds(svg: SVGSVGElement, map: ExportColorMap, resolve?: ColorResolver): void {
  if (map.background.size === 0) return;
  for (const rect of Array.from(svg.querySelectorAll('rect'))) {
    const fill = readFill(rect);
    const key = fill ? colorKey(fill, resolve) : null;
    const token = key ? map.background.get(key) : undefined;
    if (token) setFill(rect, token.fill);
  }
}

// ─── style 속성 다루기 ─────────────────────────────────────────────────────

/** inline style 우선, 없으면 fill 속성 */
function readFill(el: Element): string | null {
  return readStyle(el, 'fill') ?? el.getAttribute('fill');
}

function hasVisibleFill(el: Element): boolean {
  const fill = readFill(el);
  return fill !== null && !/^(none|transparent)$/i.test(fill.trim());
}

function readStyle(el: Element, prop: string): string | null {
  const style = el.getAttribute('style') ?? '';
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:!important)?\\s*(?:;|$)`, 'i');
  return re.exec(style)?.[1] ?? null;
}

/**
 * inline style에 `prop: value !important`를 넣는다.
 * Mermaid가 <style>에 넣는 classDef 규칙도 !important라서, inline !important여야 이긴다.
 */
function setStyle(el: Element, prop: string, value: string): void {
  const rest = (el.getAttribute('style') ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d !== '' && !new RegExp(`^${prop}\\s*:`, 'i').test(d));
  rest.push(`${prop}:${value} !important`);
  el.setAttribute('style', rest.join(';'));
}

function setFill(el: Element, value: string): void {
  el.setAttribute('fill', value);
  setStyle(el, 'fill', value);
}
