# 개발 시작하기

## 실행

Node.js 18 이상이 필요하다.

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (http://localhost:5173)
npm test         # 단위 테스트
npm run build    # 타입 검사 + 프로덕션 빌드
```

## 현재 상태

최소 동작 뼈대다. 지금 되는 것:

- 코드 입력 → Mermaid 렌더링 (클래스·시퀀스 다이어그램만 허용, REQ-01, REQ-07)
- 코드 에디터와 캔버스를 항상 함께 표시 (REQ-10)
- 코드 수정에 대한 실행 취소(Ctrl+Z) / 다시 실행(Ctrl+Y) (REQ-11, 화면에서는 코드 수정만 연결됨)
- 노드 이동·엣지 경로 수정 Command (`MoveNodeCommand`, `SetEdgePathCommand`, REQ-11) — core에는 있으나 오버레이·UI 연결 전
- JSON 저장·불러오기 로직 (REQ-12, UI 연결 전 — `DiagramModel.toJSON / load / fromJSON`). 불러오기는 파일 버전과 노드·엣지 형식을 검사하며, `load()`는 구독을 유지한 채 상태를 바꾼다
- Mermaid 코드(.mmd) 내보내기 (REQ-08 일부)
- 화면 상단에 렌더링 시간 표시 (성능 기준 실측용)

아직 없는 것: GUI 드래그 편집(REQ-02), 코드↔GUI 동기화(REQ-03), 마그네틱 커넥터(REQ-04),
엣지 경로 조정(REQ-05), 폰트 스케일링(REQ-06), PNG/JPG 내보내기(REQ-08), 흑백 4색 테마(REQ-09).

## 폴더 구조 (아키텍처의 4계층)

```
src/
├── ui/        UI 계층      화면 구성, 이벤트 처리 (App.ts)
├── core/      코어 계층    다이어그램 모델, Observer, Command (실행 취소)
├── render/    렌더링 계층  RenderEngine(Facade), 다이어그램 유형 판별
├── overlay/   렌더링 계층  Mermaid 위 오버레이 (인터페이스만, 구현 전)
├── export/    내보내기 계층  ExportStrategy (Strategy)
└── main.ts    진입점
```

| 패턴 | 위치 |
| --- | --- |
| Observer | `core/Observable.ts`, `core/DiagramModel.ts` |
| Command | `core/Command.ts` |
| Strategy | `export/ExportStrategy.ts` |
| Facade | `render/RenderEngine.ts` (mermaid import는 이 파일에만 둔다) |

## 다음에 할 일 (제안)

1. **오버레이 프로토타입(spike)** — 가장 불확실한 부분이므로 먼저 검증한다 (`src/overlay/OverlayLayer.ts` 주석 참고).
   Mermaid SVG에서 노드·엣지를 식별하고, 노드 드래그 시 엣지가 따라오는지, 노드 30개에서 평균 55fps 이상인지 확인한다.
2. PNG/JPG 내보내기 (폭 2000px 이상). Mermaid의 htmlLabels(foreignObject)가 canvas 변환에서 문제를 일으킬 수 있어 브라우저별 확인이 필요하다.
3. 저장·불러오기 UI 연결 (REQ-12).
4. 오버레이·UI에서 `MoveNodeCommand` / `SetEdgePathCommand`를 연결해 GUI 편집도 실행 취소 대상에 포함 (REQ-11).
   드래그 중에는 모델을 직접 바꿔 미리보기를 보여주고, 드래그가 끝나면 시작 위치를 `{ prev }`로 넘겨 한 번만 기록한다.
   파일을 불러온 뒤에는 `model.load(json)`과 `history.clear()`를 함께 호출한다.

## 기술 선택에 대해

Vite + TypeScript + Mermaid 11 + Vitest는 뼈대를 만들 때의 기본값이며 팀에서 확정한 것이 아니다.
프레임워크(React 등) 도입 여부는 UI 설계 단계에서 정한다.
