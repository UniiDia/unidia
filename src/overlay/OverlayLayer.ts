import type { NodeLayout, Point } from '../core/DiagramModel';

/*
 * 오버레이 레이어 (SRS 3.5: 마그네틱·엣지 경로·폰트 스케일링은 Mermaid 위의 별도 오버레이로 구현).
 *
 * 구현 현황:
 *   - ClassDiagramOverlay: 클래스 다이어그램
 *     · 노드 드래그 이동·크기 조절 (REQ-02)
 *     · 옮긴 노드에 연결된 선의 끝점을 노드 테두리에 붙여 다시 그리기 (REQ-04)
 *     · 연결선 꺾임점 추가·이동·삭제 (REQ-05)
 *   - SequenceDiagramOverlay: 시퀀스 다이어그램
 *     · 참여자 좌우 이동, 연결된 메시지가 생명선에 붙은 채 따라옴 (REQ-02, REQ-04)
 *     · 메시지 위아래 간격 조정 (순서는 유지)
 *   - 아직 없음: 클래스 다이어그램의 자기 자신으로 가는 선(self-loop) 편집
 */
export interface OverlayLayer {
  /* 렌더링된 SVG 위에 오버레이를 붙이고, 저장된 노드 위치·크기와 연결선 꺾임점을 적용한다. */
  attach(
    svgRoot: SVGSVGElement,
    layouts: Record<string, NodeLayout>,
    edgePaths: Record<string, Point[]>,
  ): void;
  /* 오버레이를 제거한다. 코드가 바뀌어 SVG가 다시 그려질 때 호출한다. */
  detach(): void;
}

/*
 * 오버레이 → 모델 연결 (UniDia 가이드 "core 사용 규칙 1"). 클래스·시퀀스 오버레이가 함께 쓴다.
 * 드래그 중에는 preview로 모델에 미리보기만 반영하고, 드래그가 끝나면 commit으로 한 번만 기록한다.
 * commit의 prev는 드래그를 시작하기 전 모델 값이다 (처음 편집이면 undefined).
 */
export interface OverlayCallbacks {
  /* 노드(참여자) 드래그·크기 조절 중 매 프레임. 취소되면 시작 전 값(undefined일 수 있음)으로 다시 부른다. */
  onLayoutPreview(nodeId: string, layout: NodeLayout | undefined): void;
  /* 노드(참여자) 드래그·크기 조절을 마쳤을 때. MoveNodeCommand(..., { prev })로 기록한다. */
  onLayoutCommit(nodeId: string, layout: NodeLayout, prev: NodeLayout | undefined): void;
  /* 꺾임점(메시지 위치)을 끄는 중 매 프레임. 취소되면 시작 전 값으로 다시 부른다. */
  onEdgePathPreview(edgeKey: string, points: Point[] | undefined): void;
  /* 꺾임점(메시지 위치) 편집을 마쳤을 때 (없애면 undefined). SetEdgePathCommand(..., { prev })로 기록한다. */
  onEdgePathCommit(edgeKey: string, points: Point[] | undefined, prev: Point[] | undefined): void;
}
