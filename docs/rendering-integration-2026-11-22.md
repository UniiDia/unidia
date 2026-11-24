# 렌더링 통합 시험 — 2026-11-22, 김태환

렌더링 담당 범위는 `src/render/`, REQ-01·06·07이다. 이번 확인에서는 다른 팀원의 공개 PR을
읽고 core·오버레이·내보내기와 연결되는 부분을 검사했다. 11/18의 로컬 작업에 이번 수정을 더했다.

## 저장소와 선행 작업

기존 `dlatkdwls/unidia`는 `UniiDia/unidia`로 이전되었다. 확인 시점에 별도 렌더링 PR은 없었다.

| 작업 | 확인한 커밋 | 상태와 적용 방식 |
| --- | --- | --- |
| [core #4](https://github.com/UniiDia/unidia/pull/4) | main `e8bd3eb` | 이미 main에 병합. `{ prev }`, `load()`, `history.clear()` 계약 확인 |
| [overlay #5](https://github.com/UniiDia/unidia/pull/5) | `32965f5` | 열려 있음. 이 브랜치의 기반이며 최신 core를 포함 |
| [export #3](https://github.com/UniiDia/unidia/pull/3) | `522d62d` | 열려 있음. 정확한 소스를 별도로 읽어 Chrome·Edge에서 호환성 시험 |

렌더링 PR은 `codex/rendering-req-01-06-07` → `feat/overlay`로 제안한다.
이렇게 하면 #5에 이미 있는 팀원 코드가 렌더링 변경으로 다시 표시되지 않는다.
#5를 먼저 main에 병합한 뒤 렌더링 PR의 base를 main으로 바꾸고 차이를 확인한다.
공유 main과 팀원 브랜치에 직접 push하거나 다른 팀원의 PR을 대신 병합하지 않는다.

## 연결 오류와 수정

1. `App.ts`와 `index.html`에서 오버레이·렌더링 변경이 충돌했다. 양쪽 기능을 유지해 연결했다.
2. 저장된 노드 배치를 적용하면 오버레이의 viewBox가 바뀐다. **오버레이 적용 → viewport 적용** 순서로
   바꾸어 이동·리사이즈가 끝나도 선택한 화면 배율이 유지되도록 했다.
3. 코드 입력 400ms 뒤 이력을 기록하면서 SVG가 교체되면 진행 중인 드래그가 중단되고 이동의 Undo가
   빠질 수 있었다. 시각 정보가 실제로 바뀐 경우만 오버레이를 다시 만들도록 수정했다.
4. Undo/Redo의 모델 알림은 히스토리 스택 갱신보다 먼저 발생한다. 동작 완료 뒤 버튼 상태도 갱신한다.
5. 입력 직후 `.mmd` 내보내기는 지연 기록 전 코드를 읽을 수 있었다. 내보내기 전에 대기 입력을 기록한다.
6. 이미지 내보내기에 원래 Mermaid SVG를 쓰면 GUI 이동이 누락된다. `serializeDiagram()`은 현재 화면의
   위치·크기·엣지를 보존하고 선택 핸들·클릭 영역·화면 배율 CSS만 제거한다. 원본 화면은 변경하지 않는다.
7. 새로운 코드를 렌더하는 동안 이전 SVG의 편집을 해제한다. 빠른 유형 전환과 오류 복구 후에도 최신
   클래스에만 오버레이를 연결한다.

## 실행 환경과 결과

- Windows 10 `10.0.19045`, Intel i7-10750H, 논리 CPU 12개, 메모리 약 16GiB.
- Node `24.18.0`, Mermaid `11.17.2`, Vite 개발 서버, 1440×900 브라우저 뷰포트.
- Playwright headless Chrome `157.0.8103.80`. 내보내기 추가 검사: Edge `158.0.4370.33`.
- 성능 측정 중 다른 빌드·브라우저 테스트를 동시에 실행하지 않았다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | **72/72 통과**: core 19, overlay 26, rendering 27 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과. Mermaid 관련 큰 번들 경고는 남아 있음 |
| Chrome 기능·통합 검사 | **14/14 통과**. 별도 export 소스 지정 포함 |
| Chrome 30개 노드 성능 검사 | **2/2 통과**, 각 20회 실제 코드 변경 |
| Edge export 호환성 검사 | **1/1 통과**, PNG/JPG × 25/100/400% |

| 유형 (노드 30, 관계 29) | 최초 반영 | 평균 | p95 | 최대 | 1초 이내 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 클래스 | 637.8ms | 576.5ms | **601.8ms** | 609.6ms | **20/20** |
| 시퀀스 | 276.4ms | 236.7ms | **249.7ms** | 254.7ms | **20/20** |

측정값은 마지막 입력부터 150ms 대기·Mermaid 호출·화면 반영용 두 프레임까지 포함한다.
첫 페이지 다운로드나 OS의 실제 화면 출력 시간은 포함하지 않는다. 11/18 클래스 p95 1,438.7ms 미달
기록은 [당시 보고서](rendering-weekly-2026-11-18.md)에 그대로 보존한다. 이번 결과만으로 모든 기기·
다이어그램에서 1초 이내라고 일반화하지 않는다.

폰트 시험은 25/50/75/100/150/200/300/400%에서 클래스 라벨 90개, 시퀀스 라벨 60개를 검사했다.
폰트/도형 높이 비율 변화 **0%**, 넘침 **0px**, 줄 수 변화 **0건**이었다.
25/100/200/400%에서 실제 마우스 이동·Undo·Redo·코드 변경 후 위치 유지도 통과했다.

내보내기는 이동한 한글 클래스 예제로 검사했다. Chrome·Edge 모두 PNG/JPG **2000×2498px**를
생성했고, 브라우저별로 25/100/400%의 출력 크기·색이 있는 픽셀 수가 같았다.
Chrome PNG를 시각 확인했으며 한글·상자·화살표와 여백이 포함되고 선택 핸들이 제거되어 있었다.
이 검사는 이미지 변환 함수와 SVG 연결 검사이며, 아직 없는 PNG/JPG 버튼을 검사했다는 의미는 아니다.

원시값·캡처: [측정 파일](measurements/2026-11-22/).

## 재현

```powershell
npm ci
npm test
npm run typecheck
npm run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:browser
npm run test:performance
```

기본 기능 검사는 export PR 소스가 없으면 13개 통과와 export 검사 1개 건너뛰기가 정상이다.
PR #3 호환성을 포함하려면 다음처럼 검증할 소스를 고정한다. 임시 파일은 저장소 밖에 둔다.

```powershell
git fetch origin feature/export
$exportSource = Join-Path $env:TEMP 'unidia-export-522d62d.ts'
git show 522d62d581c64f6773f0285bcfc82d6322e49864:src/export/ExportStrategy.ts |
  Set-Content -LiteralPath $exportSource -Encoding utf8
$env:UNIDIA_EXPORT_SOURCE = $exportSource
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:browser
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npx playwright test tests/integration.e2e.ts --grep @export-compatibility
```

## 범위와 남은 작업

- 화면 배율의 REQ-06을 검사했다. 개별 노드 리사이즈는 현재 오버레이의 글자 크기 유지 정책을 따른다.
- 클래스 GUI 편집은 #5에 의존한다. 시퀀스는 코드 편집·렌더링·전체 배율을 지원하며 GUI 편집은 미구현이다.
- PNG/JPG 버튼, JSON 저장·불러오기 UI, 흑백 4색 테마는 각 담당 작업으로 남아 있다.
- 오버레이 30개 노드 드래그 fps와 모든 엣지 경로의 정확도는 이번 렌더링 시험으로 대체하지 않는다.
