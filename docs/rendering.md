# 렌더링 모듈 — 김태환

담당 범위는 `src/render/`, REQ-01·06·07이다. 이번 주 확인 항목과 실측 결과는
[주간 시험 기록](rendering-weekly-2026-11-18.md)에 정리한다.
최신 core·오버레이·내보내기와의 연결 결과는 [11/22 통합 시험 기록](rendering-integration-2026-11-22.md)을 참고한다.

## 구성과 연동

| 구성요소 | 역할 | 연동 시 주의점 |
| --- | --- | --- |
| `RenderEngine.render(code)` | Mermaid 코드를 `{ svg, type }`으로 변환하는 Facade | 문법 오류·미지원 유형은 예외. Mermaid import는 이 파일에만 둔다. |
| `detectDiagramType(code)` | 클래스/시퀀스 판별 | YAML·주석·init 지시문을 건너뛴다. 전체 문법 검증기는 아니다. |
| `RenderScheduler` | 150ms 입력 병합, 실행 중 요청 뒤에 최신 입력 하나만 유지 | 입력 즉시 이전 결과/오류를 무효화. 화면 해제 시 `dispose()` 호출. |
| `SvgViewport` | `OverlayLayer` 계약의 `attach/detach`, `setZoom(0.25~4)` | viewBox와 내부 노드 좌표를 유지한다. 새 SVG를 표시할 때 다시 attach한다. |
| `serializeDiagram(svg)` | 화면의 수동 편집 결과를 내보내기용 SVG로 직렬화 | 선택 도구를 제거하고 화면 배율의 CSS 크기를 해제한다. 원본 DOM은 유지한다. |

`src/ui/App.ts`는 렌더링 스케줄러, 배율 선택, 실측 시간 표시와 PR #5의 오버레이를 연결한다.
저장/불러오기 UI와 PNG/JPG 내보내기 버튼은 각 담당 작업으로 남아 있다.

```ts
const { svg } = await engine.render(code);
overlay.detach();
viewport.detach();
canvas.innerHTML = svg;
const root = canvas.querySelector('svg')!;
// 클래스 다이어그램인 경우: 저장된 위치를 적용한 뒤 viewBox가 정해진다.
overlay.attach(root, model.getState().nodeLayouts, model.getState().edgePaths);
viewport.attach(root);
viewport.setZoom(2); // 200%, 폰트와 도형을 함께 확대
```

- `attach()`는 기존 배율을 유지한다. `detach()`는 원래 SVG의 크기·스타일 속성을 복원한다.
- 배율은 표시 상태다. `DiagramModel.nodeLayouts`를 수정하거나 Undo 기록을 만들지 않는다.
- 오버레이에서 포인터의 화면 좌표를 SVG 모델 좌표로 바꿀 때 `svg.getScreenCTM()?.inverse()`를 사용한다.
  200% 화면에서 드래그한 픽셀 수를 모델 좌표에 그대로 더하면 이동 거리가 두 배가 된다.
- 이미지 내보내기에는 `serializeDiagram(root)` 결과를 전달한다. 원래 Mermaid 문자열만 전달하면
  수동 이동·리사이즈가 누락된다. 출력 해상도는 내보내기 담당이 결정한다.
- 코드 이력을 400ms 뒤 기록할 때 시각 정보가 같으면 SVG를 다시 만들지 않는다.
  드래그 중 DOM을 교체하면 포인터 이벤트와 이동 기록이 끊길 수 있다.
- 기본 라벨은 SVG text이다(`htmlLabels: false`). 한글은 시스템 폰트 대체를 사용한다.
  사용자 Mermaid 설정이 라벨/폰트를 바꾸면 별도 검증이 필요하다.
- 오류는 `textContent`로 표시하고 임시 렌더 컨테이너는 성공·실패와 무관하게 제거한다.

## 유형별 지원 범위

| 유형 | 코드로 생성하는 객체 | 이번 변경에서 확인한 기능 | 다른 담당과 통합할 기능 |
| --- | --- | --- | --- |
| 클래스 | 클래스, 속성, 메서드, 상속·연관 관계, 다중성, 관계 라벨 | 코드 편집, 한글 라벨, 확대·축소, PR #5 노드 이동·리사이즈·Undo/Redo 연결 | 개별 노드 폰트 조정, 저장/불러오기 UI |
| 시퀀스 | 참여자, 생명선, 요청·응답, 활성 구간, alt/else, note | 코드 편집 후 재렌더, 한글·여러 줄 라벨, 전체 확대·축소 | 참여자/메시지의 GUI 편집 규칙 및 오버레이 |

REQ-07의 두 유형 생성은 검증했다. 두 유형의 GUI 편집까지 모두 완료한 것은 아니다.
REQ-06의 시험 대상은 전체 다이어그램 확대·축소이며 개별 노드 크기 변경은 포함하지 않는다.

## 시험 데이터

- `examples/render/class-30.mmd`: 클래스 30개, 상속 관계 29개. 모든 클래스에 속성과 메서드가 있다.
- `examples/render/sequence-30.mmd`: 참여자 30개, 메시지 29개. 위·아래 참여자 상자를 합쳐 노드 60개로 세지 않는다.
- 성능 시험은 실제 클래스 이름/메시지를 20회 바꾸고 상단의 표시값을 기록한다.
- 폰트 시험은 렌더된 폰트 픽셀 높이 / 해당 도형 높이 비율을 100% 배율과 비교한다.
  `getScreenCTM()`으로 표시 배율을 반영하며 텍스트 경계가 도형을 넘는지도 검사한다.
- 150ms 입력 대기와 두 번의 `requestAnimationFrame`을 포함한 값이다. OS 합성기나 물리 화면의
  픽셀 갱신까지 계측한 값은 아니며, 초기 페이지 다운로드 시간은 별도다.

## 참고

- [팀 주간 과제](https://www.notion.so/41b2614666928142af15f47b550b5352)
- [SRS 상세 요구사항](03-requirements.md)
- [Mermaid 공식 API 사용법](https://mermaid.js.org/config/usage.html)
- [Mermaid frontmatter 설정](https://mermaid.js.org/config/configuration.html)

구현 시 설치된 Mermaid 11.17.2의 타입/API를 확인했다. 공식 사이트의 최신 문서는 다른 주버전일 수 있다.
