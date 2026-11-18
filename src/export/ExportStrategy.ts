/** Strategy 패턴: 내보내기 형식별 알고리즘을 교체 가능하게 한다 (REQ-08). */
export interface ExportInput {
  /** 현재 렌더링된 SVG */
  svg: string;
  /** 현재 Mermaid 코드 */
  code: string;
}

export interface ExportStrategy {
  readonly id: 'png' | 'jpg' | 'mermaid';
  readonly extension: string;
  readonly mimeType: string;
  export(input: ExportInput): Promise<Blob>;
}

/** Mermaid 코드(.mmd) 내보내기 */
export class MermaidCodeExport implements ExportStrategy {
  readonly id = 'mermaid' as const;
  readonly extension = 'mmd';
  readonly mimeType = 'text/plain';

  async export({ code }: ExportInput): Promise<Blob> {
    return new Blob([code], { type: this.mimeType });
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** REQ-08 기준(잠정): 내보낸 이미지의 폭은 2000px 이상 */
const MIN_EXPORT_WIDTH = 2000;
/** 브라우저 canvas 한계 (Chrome 기준 한 변 16384px, 면적 약 2.68억 px) */
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 268_435_456;
/** 가장자리 객체·텍스트가 잘리지 않도록 viewBox 바깥에 두는 여백 (SVG 단위) */
const EXPORT_PADDING = 16;

export interface ImageExportOptions {
  /** 배경색. JPG는 투명을 지원하지 않으므로 반드시 채운다. null이면 투명 (PNG 전용). */
  background?: string | null;
  /** JPG 품질 (0~1) */
  quality?: number;
  /** 최소 출력 폭(px) */
  minWidth?: number;
}

interface PreparedSvg {
  /** 직렬화된 SVG(XML) */
  xml: string;
  /** 출력 픽셀 크기 */
  width: number;
  height: number;
}

/**
 * PNG/JPG 내보내기.
 * 흐름: SVG 문자열 → 크기·여백 보정 → <img>로 로드 → canvas에 그림 → Blob.
 *
 * 알려진 주의점: Mermaid의 htmlLabels(foreignObject)를 canvas로 그리면 브라우저에 따라
 * canvas가 오염(tainted)되어 toBlob이 SecurityError를 던지거나, 이미지 로드 자체가 실패한다
 * (특히 Safari). 이 경우 foreignObject를 SVG <text>로 바꾼 뒤 한 번 더 시도한다.
 */
export class RasterImageExport implements ExportStrategy {
  readonly mimeType: string;
  private readonly options: Required<ImageExportOptions>;

  constructor(
    readonly id: 'png' | 'jpg',
    readonly extension: string,
    mimeType: string,
    options: ImageExportOptions = {},
  ) {
    this.mimeType = mimeType;
    this.options = {
      // 논문 삽입용이므로 기본 배경은 흰색으로 둔다.
      background: options.background === undefined ? '#ffffff' : options.background,
      quality: options.quality ?? 0.95,
      minWidth: options.minWidth ?? MIN_EXPORT_WIDTH,
    };
    if (id === 'jpg' && this.options.background === null) {
      this.options.background = '#ffffff';
    }
  }

  async export({ svg }: ExportInput): Promise<Blob> {
    if (!svg.trim()) {
      throw new Error('내보낼 다이어그램이 없습니다. 먼저 코드를 렌더링해 주세요.');
    }

    try {
      return await this.rasterize(prepareSvg(svg, this.options.minWidth, false));
    } catch (error) {
      if (!isTaintOrLoadError(error)) throw error;
      // foreignObject 때문에 실패한 경우: SVG <text>로 바꿔서 재시도한다.
      return await this.rasterize(prepareSvg(svg, this.options.minWidth, true));
    }
  }

  private async rasterize({ xml, width, height }: PreparedSvg): Promise<Blob> {
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D 컨텍스트를 만들 수 없습니다.');

    if (this.options.background !== null) {
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(image, 0, 0, width, height);

    return canvasToBlob(canvas, this.mimeType, this.id === 'jpg' ? this.options.quality : undefined);
  }
}

/**
 * Mermaid SVG를 이미지로 그릴 수 있게 정리한다.
 * - Mermaid 출력은 width="100%" + style="max-width:…" 형태라 <img>로 그리면 크기가 정해지지 않는다.
 *   viewBox를 기준으로 고정 width/height를 지정한다.
 * - 벡터 상태에서 목표 해상도로 키워야 래스터화 후 흐려지지 않는다.
 */
function prepareSvg(svgText: string, minWidth: number, replaceForeignObjects: boolean): PreparedSvg {
  // Mermaid 출력에는 <br> 같은 HTML 표기가 섞여 있어 XML 파서로는 깨질 수 있다.
  // HTML 파서로 읽은 뒤 XMLSerializer로 다시 직렬화하면 올바른 XML이 된다.
  const doc = new DOMParser().parseFromString(svgText, 'text/html');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('SVG를 찾을 수 없습니다.');

  const box = readViewBox(svg);
  const padded = {
    x: box.x - EXPORT_PADDING,
    y: box.y - EXPORT_PADDING,
    width: box.width + EXPORT_PADDING * 2,
    height: box.height + EXPORT_PADDING * 2,
  };

  const scale = computeScale(padded.width, padded.height, minWidth);
  const width = Math.round(padded.width * scale);
  const height = Math.round(padded.height * scale);

  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('viewBox', `${padded.x} ${padded.y} ${padded.width} ${padded.height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.removeProperty('max-width');

  if (replaceForeignObjects) convertForeignObjectsToText(svg);

  return { xml: new XMLSerializer().serializeToString(svg), width, height };
}

function readViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const raw = svg.getAttribute('viewBox');
  if (raw) {
    const [x, y, width, height] = raw.split(/[\s,]+/).map(Number);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return { x, y, width, height };
    }
  }
  // viewBox가 없으면 width/height 속성 또는 max-width 스타일을 사용한다.
  const width = parseFloat(svg.getAttribute('width') ?? '') || parseFloat(svg.style.maxWidth) || 0;
  const height = parseFloat(svg.getAttribute('height') ?? '') || 0;
  if (width <= 0 || height <= 0) throw new Error('SVG 크기를 알 수 없습니다.');
  return { x: 0, y: 0, width, height };
}

/** 폭이 minWidth 이상이 되도록 배율을 정하되, canvas 한계를 넘지 않게 제한한다. */
function computeScale(width: number, height: number, minWidth: number): number {
  let scale = Math.max(1, minWidth / width);
  scale = Math.min(scale, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
  scale = Math.min(scale, Math.sqrt(MAX_CANVAS_AREA / (width * height)));
  return scale;
}

/**
 * foreignObject(HTML 라벨)를 SVG <text>로 바꾼다 (canvas 오염 대비 대체 경로).
 * 줄바꿈(<br>)은 유지하지만 굵게/기울임 등 HTML 서식은 일부 손실될 수 있다.
 */
function convertForeignObjectsToText(svg: SVGSVGElement): void {
  const doc = svg.ownerDocument;
  for (const fo of Array.from(svg.querySelectorAll('foreignObject'))) {
    const x = parseFloat(fo.getAttribute('x') ?? '0') || 0;
    const y = parseFloat(fo.getAttribute('y') ?? '0') || 0;
    const width = parseFloat(fo.getAttribute('width') ?? '0') || 0;
    const height = parseFloat(fo.getAttribute('height') ?? '0') || 0;

    // <br>을 줄바꿈 문자로 바꾼 뒤 텍스트만 뽑는다.
    const clone = fo.cloneNode(true) as Element;
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const lines = (clone.textContent ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      fo.remove();
      continue;
    }

    const text = doc.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x + width / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-family', '"trebuchet ms", verdana, arial, sans-serif');
    text.setAttribute('font-size', '14');
    text.setAttribute('fill', '#333333');

    const lineHeight = height > 0 ? Math.min(height / lines.length, 20) : 18;
    const firstY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      const tspan = doc.createElementNS(SVG_NS, 'tspan');
      tspan.setAttribute('x', String(x + width / 2));
      tspan.setAttribute('y', String(firstY + i * lineHeight));
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    fo.replaceWith(text);
  }
}

/** 이미지 로드 실패를 구분하기 위한 오류 */
class ImageLoadError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ImageLoadError('SVG를 이미지로 불러오지 못했습니다.'));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      // canvas가 오염되었으면 여기서 SecurityError가 동기적으로 발생한다.
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('이미지 인코딩에 실패했습니다.'))),
        type,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}

function isTaintOrLoadError(error: unknown): boolean {
  if (error instanceof ImageLoadError) return true;
  return error instanceof DOMException && error.name === 'SecurityError';
}

export const exportStrategies: ExportStrategy[] = [
  new MermaidCodeExport(),
  new RasterImageExport('png', 'png', 'image/png'),
  new RasterImageExport('jpg', 'jpg', 'image/jpeg'),
];
