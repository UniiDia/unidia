import type { OverlayLayer } from '../overlay/OverlayLayer';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

const MANAGED_ATTRIBUTES = ['width', 'height', 'style', 'preserveAspectRatio'] as const;

/**
 * REQ-06: Mermaid가 만든 viewBox는 유지하고 표시 크기만 균일하게 조절한다.
 * 텍스트·도형·엣지가 함께 확대되므로 폰트 비율과 줄바꿈이 변하지 않는다.
 * OverlayLayer 계약을 사용하며 노드 이동/리사이즈의 모델 좌표는 수정하지 않는다.
 */
export class SvgViewport implements OverlayLayer {
  private svg?: SVGSVGElement;
  private original = new Map<string, string | null>();
  private width = 0;
  private height = 0;
  private scale = 1;

  get zoom(): number {
    return this.scale;
  }

  attach(svgRoot: SVGSVGElement): void {
    const values = (svgRoot.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
      throw new Error('확대·축소에 필요한 SVG viewBox가 올바르지 않습니다.');
    }
    this.detach();
    this.svg = svgRoot;
    this.width = values[2];
    this.height = values[3];
    for (const name of MANAGED_ATTRIBUTES) this.original.set(name, svgRoot.getAttribute(name));
    this.apply();
  }

  detach(): void {
    if (this.svg) {
      for (const [name, value] of this.original) {
        if (value === null) this.svg.removeAttribute(name);
        else this.svg.setAttribute(name, value);
      }
    }
    this.svg = undefined;
    this.original.clear();
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) throw new RangeError('배율은 유한한 숫자여야 합니다.');
    this.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.apply();
  }

  private apply(): void {
    if (!this.svg) return;
    const width = this.width * this.scale;
    const height = this.height * this.scale;
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
    this.svg.style.maxWidth = 'none';
    this.svg.style.display = 'block';
  }
}
