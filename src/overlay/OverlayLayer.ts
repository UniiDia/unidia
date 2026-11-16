import type { NodeLayout } from '../core/DiagramModel';

/**
 * 오버레이 레이어 (SRS 3.5: 마그네틱·엣지 경로·폰트 스케일링은 Mermaid 위의 별도 오버레이로 구현).
 *
 * 구현 현황:
 *   - ClassDiagramOverlay: 클래스 다이어그램 노드 드래그 이동·크기 조절 (REQ-02),
 *     옮긴 노드에 연결된 선을 직선으로 다시 그리기 (REQ-04 기본형)
 *   - 아직 없음: 시퀀스 다이어그램 편집, 엣지 꺾임점 드래그 (REQ-05)
 */
export interface OverlayLayer {
  /** 렌더링된 SVG 위에 오버레이를 붙이고, 저장된 노드 위치·크기를 적용한다. */
  attach(svgRoot: SVGSVGElement, layouts: Record<string, NodeLayout>): void;
  /** 오버레이를 제거한다. 코드가 바뀌어 SVG가 다시 그려질 때 호출한다. */
  detach(): void;
}
