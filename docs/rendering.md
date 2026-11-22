# 렌더링 모듈 — 김태환

담당 범위는 `src/render/`, REQ-01·06·07이다. 이번 주 확인 항목과 실측 결과는
[주간 시험 기록](rendering-weekly-2026-11-18.md)에 정리한다.

## 구성과 연동

| 구성요소 | 역할 | 연동 시 주의점 |
| --- | --- | --- |
| `RenderEngine.render(code)` | Mermaid 코드를 `{ svg, type }`으로 변환하는 Facade | 문법 오류·미지원 유형은 예외. Mermaid import는 이 파일에만 둔다. |
| `detectDiagramType(code)` | 클래스/시퀀스 판별 | YAML·주석·init 지시문을 건너뛴다. 전체 문법 검증기는 아니다. |
| `RenderScheduler` | 150ms 입력 병합, 실행 중 요청 뒤에 최신 입력 하나만 유지 | 입력 즉시 이전 결과/오류를 무효화. 화면 해제 시 `dispose()` 호출. |
| `SvgViewport` | `OverlayLayer` 계약의 `attach/detach`, `setZoom(0.25~4)` | viewBox와 내부 노드 좌표를 유지한다. 새 SVG를 표시할 때 다시 attach한다. |

`src/ui/App.ts`의 변경은 렌더링 스케줄러, 배율 선택, 실측 시간 표시를 연결하는 부분이다.
저장/불러오기, 단축키, GUI 편집 기능은 각 담당 영역에 남아 있다.

```ts
const { svg } = await engine.render(code);
viewport.detach();
canvas.innerHTML = svg;
viewport.attach(canvas.querySelector('svg')!);
viewport.setZoom(2); // 200%, 폰트와 도형을 함께 확대
```

- `attach()`는 기존 배율을 유지한다. `detach()`는 원래 SVG의 크기·스타일 속성을 복원한다.
- 배율은 표시 상태다. `DiagramModel.nodeLayouts`를 수정하거나 Undo 기록을 만들지 않는다.
- 오버레이에서 포인터의 화면 좌표를 SVG 모델 좌표로 바꿀 때 `svg.getScreenCTM()?.inverse()`를 사용한다.
  200% 화면에서 드래그한 픽셀 수를 모델 좌표에 그대로 더하면 이동 거리가 두 배가 된다.
- 이미지 내보내기에는 화면 배율 적용 전 SVG를 전달한다. 출력 해상도는 내보내기 담당이 결정한다.
- 기본 라벨은 SVG text이다(`htmlLabels: false`). 한글은 시스템 폰트 대체를 사용한다.
  사용자 Mermaid 설정이 라벨/폰트를 바꾸면 별도 검증이 필요하다.
- 오류는 `textContent`로 표시하고 임시 렌더 컨테이너는 성공·실패와 무관하게 제거한다.

## 유형별 지원 범위

| 유형 | 코드로 생성하는 객체 | 이번 변경에서 확인한 기능 | 다른 담당과 통합할 기능 |
| --- | --- | --- | --- |
| 클래스 | 클래스, 속성, 메서드, 상속·연관 관계, 다중성, 관계 라벨 | 코드 편집 후 재렌더, 한글 라벨, 전체 확대·축소 | 노드 드래그·개별 리사이즈, 엣지 경로, GUI 수정 저장 |
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
