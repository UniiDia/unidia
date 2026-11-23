/**
 * REQ-09: 흑백(그레이스케일) 인쇄 시에도 4가지 색이 구분되는 팔레트.
 *
 * 확인 기준(잠정): Rec.709 휘도로 그레이스케일 변환 후, 4색 중 어느 두 색을 골라도 명도(L*) 차이 20 이상.
 * 흑백 인쇄에서는 색상(hue) 정보가 사라지므로 명도가 일정 간격으로 떨어진 색을 토큰으로 정의한다.
 *
 * - 화면 렌더링: 테마 색과 classDef(c1~c4)로 팔레트를 사용한다 (사용자 지정 색은 그대로 보여준다).
 * - 내보내기: 사용자가 직접 지정한 색(style/classDef/rect/box)을 가장 가까운 토큰 색으로 바꾼다.
 */

export type PaletteTokenId = 'c1' | 'c2' | 'c3' | 'c4';

export interface PaletteToken {
  readonly id: PaletteTokenId;
  /** 채움색 (#rrggbb) */
  readonly fill: string;
  /** 이 채움색 위에서 읽히는 글자색 */
  readonly text: string;
}

/** 명도 높은 순. L* ≈ 95.2 / 70.9 / 47.4 / 22.9 */
export const PALETTE: readonly PaletteToken[] = [
  { id: 'c1', fill: '#fff2b3', text: '#000000' }, // 연노랑
  { id: 'c2', fill: '#7fb2e5', text: '#000000' }, // 하늘
  { id: 'c3', fill: '#3a7d5c', text: '#ffffff' }, // 초록
  { id: 'c4', fill: '#5b2147', text: '#ffffff' }, // 자주
];

/** REQ-09 확인 기준: 토큰 간 최소 L* 차이 */
export const MIN_DELTA_L = 20;

/** 선·테두리·기본 글자색 (팔레트와 별개로 항상 검정) */
export const INK = '#000000';
export const PAPER = '#ffffff';

// ─── 색 변환 ────────────────────────────────────────────────────────────────

export interface Rgb {
  /** 0~255 */
  r: number;
  g: number;
  b: number;
}

/**
 * CSS 색 문자열을 RGB로 읽는다. 지원: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla().
 * 알파가 있으면 흰 배경(PAPER) 위에 합성한 불투명 색으로 계산한다 (인쇄 결과 기준).
 * 그 밖의 형식(색 이름 등)은 null.
 */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    const alpha = h.length === 8 ? n(6) / 255 : 1;
    return composite({ r: n(0), g: n(2), b: n(4) }, alpha);
  }

  const fn = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter((p) => p !== '');
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts.length === 4 ? parseAlpha(parts[3]) : 1;
  if (alpha === null) return null;

  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) =>
      p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p),
    );
    if (![r, g, b].every(Number.isFinite)) return null;
    return composite({ r: clamp255(r), g: clamp255(g), b: clamp255(b) }, alpha);
  }

  const h = parseFloat(parts[0]);
  const sat = parseFloat(parts[1]) / 100;
  const light = parseFloat(parts[2]) / 100;
  if (![h, sat, light].every(Number.isFinite)) return null;
  return composite(hslToRgb(h, sat, light), alpha);
}

function parseAlpha(p: string): number | null {
  const a = p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p);
  return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : null;
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

function composite(c: Rgb, alpha: number): Rgb {
  if (alpha >= 1) return c;
  const bg = 255;
  return {
    r: c.r * alpha + bg * (1 - alpha),
    g: c.g * alpha + bg * (1 - alpha),
    b: c.b * alpha + bg * (1 - alpha),
  };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255 };
}

/** sRGB 감마 → 선형 */
function toLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Rec.709 상대 휘도 Y (0~1) */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** CIE L* (0~100) */
export function lStar(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27;
}

/** 색 문자열의 그레이스케일 명도 L*. 읽을 수 없는 색이면 예외. */
export function lightnessOf(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) throw new Error(`색을 읽을 수 없습니다: ${color}`);
  return lStar(relativeLuminance(rgb));
}

/** 모든 색 쌍 중 가장 작은 L* 차이 */
export function minPairwiseDeltaL(colors: readonly string[]): number {
  const ls = colors.map(lightnessOf);
  let min = Infinity;
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) min = Math.min(min, Math.abs(ls[i] - ls[j]));
  }
  return min;
}

/** CIELAB (D65) — "가까운 색"은 사람 눈에 가까운 정도(ΔE)로 판단한다. */
function toLab(rgb: Rgb): [number, number, number] {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export interface NearestOptions {
  /**
   * true면 글자색이 검정인 토큰만 후보로 쓴다.
   * 시퀀스 다이어그램의 rect/box처럼 글자색을 바꿀 수 없는 배경에 쓴다.
   */
  darkTextOnly?: boolean;
}

/** 가장 가까운 토큰 (CIELAB ΔE76). 읽을 수 없는 색이면 null. */
export function nearestToken(color: string, options: NearestOptions = {}): PaletteToken | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const target = toLab(rgb);
  const candidates = options.darkTextOnly ? PALETTE.filter((t) => t.text === INK) : PALETTE;

  let best = candidates[0];
  let bestDist = Infinity;
  for (const token of candidates) {
    const lab = toLab(parseColor(token.fill)!);
    const dist = Math.hypot(lab[0] - target[0], lab[1] - target[1], lab[2] - target[2]);
    if (dist < bestDist) {
      best = token;
      bestDist = dist;
    }
  }
  return best;
}

function toRgbFunction(hex: string): string {
  const { r, g, b } = parseColor(hex)!;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// ─── Mermaid 코드 변환 ─────────────────────────────────────────────────────

/** 색 이름(red 등)처럼 parseColor가 못 읽는 색을 #rrggbb로 바꿔 주는 함수 */
export type ColorResolver = (color: string) => string | null;

/** 브라우저 canvas로 CSS 색 이름을 해석한다. DOM이 없으면(테스트 등) null. */
export const browserColorResolver: ColorResolver = (color) => {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  // 잘못된 값은 무시되므로, 두 기준색으로 각각 설정해 봐서 둘 다 같은 결과일 때만 유효로 본다.
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  const a = String(ctx.fillStyle);
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = color;
  const b = String(ctx.fillStyle);
  return a === b ? a : null;
};

function headerLine(lines: string[]): string | undefined {
  return lines.map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('%%'));
}

function isClassDiagram(lines: string[]): boolean {
  return headerLine(lines)?.startsWith('classDiagram') ?? false;
}

function isSequenceDiagram(lines: string[]): boolean {
  return headerLine(lines)?.startsWith('sequenceDiagram') ?? false;
}

/** 사용자가 이미 정의한 classDef 이름 */
function definedClassNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const m = /^\s*classDef\s+(\S+)/.exec(line);
    if (m) m[1].split(',').forEach((n) => names.add(n));
  }
  return names;
}

/**
 * 클래스 다이어그램 코드 끝에 팔레트 classDef(c1~c4)를 붙인다.
 * 사용자는 `class A:::c3` 처럼 토큰을 쓸 수 있다.
 * - 같은 이름의 classDef가 이미 있으면 사용자 정의를 존중해 그 토큰은 붙이지 않는다.
 * - 시퀀스 다이어그램은 classDef 문법이 없으므로 그대로 둔다.
 * - 끝에 붙이는 이유: Mermaid는 classDef 시점에 이미 존재하는 클래스에만 인라인 스타일을 넣는다.
 */
export function injectPaletteClassDefs(code: string): string {
  const lines = code.split('\n');
  if (!isClassDiagram(lines)) return code;
  const defined = definedClassNames(lines);
  const missing = PALETTE.filter((t) => !defined.has(t.id)).map(
    (t) => `  classDef ${t.id} fill:${t.fill},stroke:${INK},color:${t.text}`,
  );
  if (missing.length === 0) return code;
  const base = code.replace(/\s+$/, '');
  return `${base}\n  %% UniDia 흑백 인쇄용 팔레트 (REQ-09)\n${missing.join('\n')}\n`;
}

/** 괄호 안의 쉼표(rgb(1,2,3))는 나누지 않고 쉼표로 자른다. */
function splitStyleProps(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function resolveToken(
  color: string,
  resolve: ColorResolver | undefined,
  options?: NearestOptions,
): PaletteToken | null {
  // 투명은 "색 없음"이므로 토큰으로 바꾸지 않는다.
  if (/^(transparent|none)$/i.test(color.trim())) return null;
  const direct = nearestToken(color, options);
  if (direct) return direct;
  const resolved = resolve?.(color.trim());
  return resolved ? nearestToken(resolved, options) : null;
}

/**
 * `fill:#f00,stroke:#333,color:#fff` 형태의 스타일 목록에서 fill을 토큰 색으로 바꾸고,
 * 글자가 읽히도록 color도 토큰의 글자색으로 맞춘다. fill이 없거나 읽을 수 없으면 그대로 둔다.
 */
const STYLE_PROP = /^(\s*)([\w-]+)(\s*:\s*)(.+?)(\s*(?:!important)?\s*)$/i;

function remapStyleProps(props: string, resolve: ColorResolver | undefined): string {
  const trailing = /;\s*$/.test(props) ? ';' : '';
  const items = splitStyleProps(trailing ? props.replace(/;\s*$/, '') : props);

  // 1) fill → 가장 가까운 토큰
  let token: PaletteToken | null = null;
  for (let i = 0; i < items.length; i++) {
    const m = STYLE_PROP.exec(items[i]);
    if (!m || m[2].toLowerCase() !== 'fill') continue;
    const found = resolveToken(m[4], resolve);
    if (!found) continue;
    token = found;
    items[i] = `${m[1]}${m[2]}${m[3]}${found.fill}${m[5]}`;
  }
  if (!token) return props;

  // 2) color → 토큰 글자색 (어두운 토큰에 검정 글자가 남지 않도록)
  let hasColor = false;
  for (let i = 0; i < items.length; i++) {
    const m = STYLE_PROP.exec(items[i]);
    if (!m || m[2].toLowerCase() !== 'color') continue;
    hasColor = true;
    items[i] = `${m[1]}${m[2]}${m[3]}${token.text}${m[5]}`;
  }
  if (!hasColor) items.push(`color:${token.text}`);
  return items.join(',') + trailing;
}

// ─── 이미지(SVG) 변환용 색 대응표 ──────────────────────────────────────────

/** 색을 비교용 키("r,g,b")로 바꾼다. 투명·읽을 수 없는 색이면 null. */
export function colorKey(color: string, resolve: ColorResolver | undefined = browserColorResolver): string | null {
  const c = color.trim();
  if (c === '' || /^(transparent|none)$/i.test(c)) return null;
  const rgb = parseColor(c) ?? (resolve ? parseColor(resolve(c) ?? '') : null);
  if (!rgb) return null;
  return [rgb.r, rgb.g, rgb.b].map((v) => Math.round(v)).join(',');
}

export function tokenById(id: string): PaletteToken | undefined {
  return PALETTE.find((t) => t.id === id);
}

/**
 * 내보내기 이미지에서 "어떤 색을 어떤 토큰으로 바꿀지" 대응표.
 * applyPaletteForExport(.mmd)와 같은 규칙(resolveToken)을 써서 .mmd와 이미지의 색이 일치한다.
 */
export interface ExportColorMap {
  /** 클래스: 사용자 classDef 이름 → 토큰 (나머지 노드는 현재 fill에서 가장 가까운 토큰) */
  byClass: Map<string, PaletteToken>;
  /** 시퀀스: rect/box 색(colorKey) → 토큰 (글자색이 검정인 토큰만) */
  background: Map<string, PaletteToken>;
}

export function buildExportColorMap(code: string, options: PaletteExportOptions = {}): ExportColorMap {
  const resolve = options.resolveColor ?? browserColorResolver;
  const map: ExportColorMap = { byClass: new Map(), background: new Map() };
  const lines = code.split('\n');

  if (isClassDiagram(lines)) {
    for (const line of lines) {
      if (line.trim().startsWith('%%')) continue;
      const m = /^\s*classDef\s+(\S+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const props = splitStyleProps(m[2].replace(/;\s*$/, ''));
      for (const item of props) {
        const p = STYLE_PROP.exec(item);
        if (!p || p[2].toLowerCase() !== 'fill') continue;
        const token = resolveToken(p[4], resolve);
        if (token) m[1].split(',').forEach((name) => map.byClass.set(name, token));
      }
    }
  } else if (isSequenceDiagram(lines)) {
    for (const line of lines) {
      const rect = /^\s*rect\s+(.+?)\s*$/i.exec(line);
      const box = /^\s*box\s+((?:rgba?|hsla?)\s*\([^)]*\)|\w+)/i.exec(line);
      const color = rect?.[1] ?? box?.[1];
      if (!color) continue;
      const token = resolveToken(color, resolve, { darkTextOnly: true });
      const key = colorKey(color, resolve);
      if (token && key) map.background.set(key, token);
    }
  }
  return map;
}

export interface PaletteExportOptions {
  /** 색 이름 해석기. 기본값은 브라우저 canvas 사용 */
  resolveColor?: ColorResolver;
}

/**
 * 내보내기용 코드: 사용자가 직접 지정한 색을 가장 가까운 토큰 색으로 바꾸고 팔레트 classDef를 붙인다.
 * 화면에는 사용자 원래 색이 보이고, 내보낸 결과물(PNG/JPG/.mmd)만 흑백 구분 기준을 만족한다.
 *
 * 변환 대상
 * - 클래스: `style <id> fill:…`, `classDef <이름> fill:…` → fill은 토큰 색, color는 토큰 글자색
 * - 시퀀스: `rect <색>`, `box <색> <제목>` → 토큰 색 (rgb() 형식, box는 hex를 받지 않음)
 *   이 배경 위의 메시지·제목 글자색은 바꿀 수 없으므로 글자색이 검정인 밝은 토큰(c1, c2)만 쓴다.
 */
export function applyPaletteForExport(code: string, options: PaletteExportOptions = {}): string {
  const resolve = options.resolveColor ?? browserColorResolver;
  const lines = code.split('\n');

  if (isClassDiagram(lines)) {
    const converted = lines.map((line) => {
      const m = /^(\s*(?:style|classDef)\s+\S+\s+)(.+)$/.exec(line);
      if (!m || line.trim().startsWith('%%')) return line;
      return m[1] + remapStyleProps(m[2], resolve);
    });
    return injectPaletteClassDefs(converted.join('\n'));
  }

  if (isSequenceDiagram(lines)) {
    return lines
      .map((line) => {
        const rect = /^(\s*rect\s+)(.+?)(\s*)$/i.exec(line);
        if (rect) {
          const token = resolveToken(rect[2], resolve, { darkTextOnly: true });
          return token ? `${rect[1]}${toRgbFunction(token.fill)}${rect[3]}` : line;
        }
        // Mermaid parseBoxData와 같은 규칙으로 앞부분의 색을 떼어 낸다.
        const box = /^(\s*box\s+)((?:rgba?|hsla?)\s*\([^)]*\)|\w+)(.*)$/i.exec(line);
        if (box) {
          const token = resolveToken(box[2], resolve, { darkTextOnly: true });
          // 색이 아닌 단어(제목의 첫 단어)면 resolveToken이 null → 그대로 둔다.
          return token ? `${box[1]}${toRgbFunction(token.fill)}${box[3]}` : line;
        }
        return line;
      })
      .join('\n');
  }

  return code;
}
