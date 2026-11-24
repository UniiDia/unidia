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

현재 브랜치는 main의 core PR #4와 오버레이 PR #5 위에 렌더링 작업을 연결한 상태다.
main 반영 여부와 이 브랜치에서 동작하는 기능을 구분한다. 지금 되는 것:

- 코드 입력 → Mermaid 렌더링 (클래스·시퀀스 다이어그램만 허용, REQ-01, REQ-07)
- 코드 에디터와 캔버스를 항상 함께 표시 (REQ-10)
- 코드 수정·클래스 노드 이동·크기 조절·엣지 경로 수정에 대한 실행 취소(Ctrl+Z) / 다시 실행(Ctrl+Y) (REQ-11)
- 클래스 노드 이동·크기 조절, 마그네틱 연결선·꺾임점 편집 (REQ-02, 04, 05, 오버레이 PR #5)
- 시각 정보와 코드를 분리하고 코드 수정 후 수동 위치·크기를 재적용 (REQ-03)
- JSON 저장·불러오기 로직 (REQ-12, UI 연결 전 — `DiagramModel.toJSON / load / fromJSON`). 불러오기는 파일 버전과 노드·엣지 형식을 검사하며, `load()`는 구독을 유지한 채 상태를 바꾼다
- Mermaid 코드(.mmd) 내보내기 (REQ-08 일부)
- 화면 상단에 렌더링 시간 표시 (성능 기준 실측용)
- 25%~400% SVG 확대·축소, 도형과 폰트를 같은 비율로 표시 (REQ-06, 전체 다이어그램 배율)
- 최신 입력만 표시하는 렌더링 스케줄러와 오류 후 복구 (REQ-01)
- 유형 판별 시 YAML frontmatter·여러 줄 지시문·주석 처리, 잘못된 유형 접두어 거절 (REQ-07)

아직 없는 것: 시퀀스 GUI 편집, 개별 노드 리사이즈와 연결되는 폰트 조정,
PNG/JPG 내보내기 UI(REQ-08), 흑백 4색 테마(REQ-09). PNG/JPG 변환은 별도 PR #3에 있으며
이번 브랜치에는 복사하지 않고 호환성 시험에서 해당 PR 소스를 불러와 검사한다.

렌더링 담당의 주간 실측 결과는 [2026-11-18 렌더링 시험 기록](rendering-weekly-2026-11-18.md)에 있다.
REQ-01의 1초 성능 목표는 기능 동작 여부와 별개로 판정한다. 11/18 클래스 측정은 미달이었고,
11/22 통합 상태의 재측정에서는 클래스·시퀀스 모두 20/20회 통과했다. 환경과 원시값은 아래 통합 기록에 남겼다.
상단의 `반영 …ms`는 마지막 입력부터 150ms 대기, Mermaid 렌더, 화면 반영 프레임까지 포함한다.
이전 뼈대의 `렌더 …ms`는 Mermaid 호출 시간만 측정하므로 두 값을 그대로 비교하면 안 된다.

## 폴더 구조 (아키텍처의 4계층)

```
src/
├── ui/        UI 계층      화면 구성, 이벤트 처리 (App.ts)
├── core/      코어 계층    다이어그램 모델, Observer, Command (실행 취소)
├── render/    렌더링 계층  RenderEngine(Facade), 다이어그램 유형 판별
├── overlay/   렌더링 계층  클래스 노드·엣지 편집 오버레이
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

1. 통합 시 렌더링 성능 기준 유지. 오버레이 드래그 fps는 [오버레이 측정 절차](overlay.md)로 별도 확인한다.
2. PR #3의 PNG/JPG 변환을 UI에 연결 (폭 2000px 이상). `serializeDiagram()`으로 화면의 수동 편집 결과를 전달한다.
3. 저장·불러오기 UI 연결 (REQ-12).
4. 시퀀스 GUI 편집과 개별 노드 폰트 조정 범위 확정.
   현재 클래스 드래그는 모델을 직접 바꿔 미리보기를 보여주고, 끝나면 시작 위치를 `{ prev }`로 넘겨 한 번만 기록한다.
   파일을 불러온 뒤에는 `model.load(json)`과 `history.clear()`를 함께 호출한다.

## 기술 선택에 대해

Vite + TypeScript + Mermaid 11 + Vitest는 뼈대를 만들 때의 기본값이며 팀에서 확정한 것이 아니다.
프레임워크(React 등) 도입 여부는 UI 설계 단계에서 정한다.

## 렌더링 검증

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium  # 처음 한 번, 테스트용 브라우저가 없을 때
npm run test:browser             # 기능·폰트 스케일링 검증
npm run test:performance         # 30개 노드, 유형별 20회 실측 및 1초 기준 판정
```

SRS의 Chrome 기준으로 설치된 Chrome을 사용하려면 PowerShell에서
`$env:PLAYWRIGHT_CHANNEL = 'chrome'`을 설정한 뒤 실행한다. Edge는 `msedge`를 사용한다.
성능 검증은 다른 빌드나 테스트와 동시에 실행하지 않는다. 임계값 미달이면 명령은 실패하며,
그 경우에도 `test-results/`에 JSON 원시 측정값과 캡처를 남긴다. 두 검증을 함께 실행하려면
`npx playwright test`를 사용한다.

[연동 API와 범위](rendering.md), [30개 클래스 예제](../examples/render/class-30.mmd),
[30개 참여자 시퀀스 예제](../examples/render/sequence-30.mmd)를 참고한다.

오버레이·core·내보내기 PR과의 연결 확인 및 재현 명령은
[2026-11-22 통합 시험 기록](rendering-integration-2026-11-22.md)에 있다.
