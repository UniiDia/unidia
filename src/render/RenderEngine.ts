import mermaid from 'mermaid';
import { diagramLabels, detectDiagramType, type DiagramType } from './diagramTypes';

export interface RenderResult {
  svg: string;
  type: DiagramType;
}

// Mermaid는 전역 설정과 작업 큐를 사용하므로 모든 Facade 인스턴스가 공유한다.
let initialized = false;
let renderId = 0;

/**
 * Facade 패턴: Mermaid.js API를 감싸 단순한 창구로 노출한다.
 * 렌더링 엔진을 교체해도 나머지 코드에 영향이 없도록 mermaid import는 이 파일에만 둔다.
 */
export class RenderEngine {
  private init(): void {
    if (initialized) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      // SVG text는 도형과 같은 좌표계에서 확대되며 이미지 내보내기에도 유리하다.
      htmlLabels: false,
      fontFamily: 'Arial, "Malgun Gothic", sans-serif',
      class: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
    initialized = true;
  }

  /** 코드를 SVG 문자열로 렌더링한다. 문법 오류면 예외를 던진다. */
  async render(code: string): Promise<RenderResult> {
    const type = detectDiagramType(code);
    if (!type) {
      throw new Error(`지원하지 않는 다이어그램입니다. 지원 유형: ${Object.values(diagramLabels).join(', ')}`);
    }
    this.init();
    const id = `unidia-render-${renderId++}`;
    // 크기 측정용 임시 SVG를 실제 미리보기와 분리하고 종료 시 함께 정리한다.
    // display:none은 getBBox 측정을 깨뜨리므로 visibility:hidden을 사용한다.
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style paint;';
    document.body.appendChild(container);
    try {
      const { svg } = await mermaid.render(id, code, container);
      return { svg, type };
    } finally {
      // 실패한 렌더의 임시 SVG도 이 컨테이너와 함께 제거된다.
      container.remove();
    }
  }
}
