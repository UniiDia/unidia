# 내보내기 (src/export) — REQ-08, 09

현재 다이어그램을 PNG·JPG 이미지나 Mermaid 코드(.mmd) 파일로 내보낸다.
PNG·JPG는 내보낼 때 **흑백 인쇄용(4색 팔레트)**과 **화면 색 그대로** 중에서 고른다.
화면에 보이는 다이어그램은 바뀌지 않고, 내보낸 결과물에만 적용된다.

## 내보내기 형식

툴바 버튼 3개로 내보낸다. 형식마다 Strategy 하나가 담당한다 (`ExportStrategy`, Strategy 패턴).

| 버튼 | 파일 | 담당 | 내용 |
| --- | --- | --- | --- |
| Mermaid 코드 내보내기 | `diagram.mmd` | `MermaidCodeExport` | 작성한 코드 **그대로** (색 변환·팔레트 추가 없음) |
| PNG 내보내기 | `diagram.png` | `RasterImageExport('png')` | 폭 2000px 이상 이미지, 흰 배경. 색상 선택 창이 뜸 |
| JPG 내보내기 | `diagram.jpg` | `RasterImageExport('jpg')` | PNG와 같음, 품질 0.95 |

## 색상 선택 (PNG·JPG)

PNG·JPG 버튼을 누르면 선택 창이 뜬다 (`colorModeDialog.ts`, 브라우저 기본 `<dialog>`).

| 선택 | `colorMode` | 결과 |
| --- | --- | --- |
| 흑백 인쇄용 (4색 팔레트) — 기본 선택 | `'grayscale'` | 상자 색을 c1~c4로 바꿔 내보냄 (아래 REQ-09) |
| 화면 색 그대로 | `'original'` | 캔버스에 보이는 색 그대로 내보냄 (컬러 출력용) |
| 취소 (취소 버튼·Esc·창 바깥 클릭) | — | 파일을 만들지 않음. `ExportCancelledError` → 상태 표시줄에 "내보내기를 취소했습니다." |

선택 창은 UI 계층을 고치지 않고 내보내기 안에서 띄운다. UI에서 미리 고르게 하려면 `export({ svg, code, colorMode })`로 넘기면 되고, 그때는 창이 뜨지 않는다 (아래 사용법).

## 이미지 해상도 (REQ-08)

기준(잠정): 이미지 폭 2000px 이상, 객체·텍스트 잘림 0건

- 작은 다이어그램은 폭 2000px가 되도록 키운다. 이미지로 바꾸기 전 벡터(SVG) 상태에서 키우므로 흐려지지 않는다.
- 이미 2000px보다 크면 원래 크기로 둔다 (줄이지 않음).
- 가장자리가 잘리지 않도록 다이어그램 둘레에 여백 16px(SVG 단위)를 둔다.
- 브라우저 canvas 한계(한 변 16384px)를 넘으면 한계에 맞춰 줄인다. 줄인 뒤에도 폭이 2000px 이상이면 그대로 내보낸다.
- 줄인 결과가 2000px보다 작아지면 `ExportSizeError`로 **내보내기를 중단**한다. 기준에 못 미치는 이미지를 조용히 내보내지 않기 위해서다.
  예: 세로로 아주 긴 시퀀스 다이어그램. 오류 메시지(가능한 최대 폭 포함)는 상태 표시줄에 나온다.

크기 계산은 `computeExportSize(폭, 높이, 최소폭)`에 모여 있다.

### 브라우저 호환 (foreignObject 대체 경로)

Mermaid는 글자를 HTML(`<foreignObject>`)로 그리는데, 브라우저에 따라(특히 Safari) 이 SVG를 이미지로 바꾸지 못한다.
이럴 때는 HTML 글자를 SVG `<text>`로 바꿔 한 번 더 시도한다. 줄바꿈과 글자색은 유지하지만 굵게·기울임 같은 서식은 일부 사라질 수 있다.

## 흑백 인쇄용 4색 팔레트 (REQ-09)

색상 선택에서 **흑백 인쇄용**을 골랐을 때만 적용된다.

기준(잠정): 그레이스케일(Rec.709 휘도) 변환 후 어느 두 색을 골라도 명도(L*) 차이 20 이상

| 토큰 | 색 | 명도(L*) | 글자색 |
| --- | --- | --- | --- |
| c1 | `#fff2b3` 연노랑 | 95.2 | 검정 |
| c2 | `#7fb2e5` 하늘 | 70.9 | 검정 |
| c3 | `#3a7d5c` 초록 | 47.4 | 흰색 |
| c4 | `#5b2147` 자주 | 22.9 | 흰색 |

흑백으로 인쇄하면 색깔(hue)은 사라지고 밝기만 남으므로, 밝기가 23 이상씩 떨어진 4색을 골랐다.
팔레트를 바꿀 때는 `palette.ts`의 `PALETTE`만 고치면 되고, 기준을 어기면 `palette.test.ts`가 실패한다.

### 색을 바꾸는 규칙

- 상자 색을 c1~c4 중 **눈으로 보기에 가장 가까운 색**(CIELAB 색차)으로 바꾼다.
- 대상은 사용자가 지정한 색과 Mermaid 기본 색 **모두**다. 예: 기본 클래스 상자(연보라 `#ECECFF`) → c2
- 어두운 색(c3, c4)으로 바뀐 상자는 글자를 흰색으로 바꿔 읽을 수 있게 한다.
- 서로 다른 색이 같은 토큰에 가까우면 **같은 색으로 합쳐진다** (의도한 동작). 남은 색끼리는 항상 기준을 만족한다.

### 다이어그램별 변환 대상

| 다이어그램 | 바뀌는 것 |
| --- | --- |
| 클래스 | 모든 클래스 상자(`g.node`)의 채움색과 글자색 |
| 시퀀스 | 참여자·노트·loop 라벨·활성 막대(기본 색), `rect`·`box` 배경(사용자 색) |

- 시퀀스 상자 위 글자는 색을 바꿀 수 없어서, 시퀀스에서는 밝은 토큰(c1, c2)만 쓴다.
- 선·화살표·테두리·상자 밖 글자는 바꾸지 않는다.
- 클래스 다이어그램에서 `class A:::c3`처럼 토큰 이름을 쓰면 흑백 인쇄용 이미지에서 그 색이 적용된다. 화면과 .mmd에는 해당 classDef가 없으므로 색이 없다.
- .mmd는 코드를 그대로 내보내므로 팔레트가 적용되지 않는다.

### 동작 방식

Mermaid를 다시 호출하지 않는다 (Facade 규칙: mermaid import는 `RenderEngine`에만).
화면에 이미 그려진 SVG를 받아 **사본**을 만들고, 그 사본의 색만 바꾼 뒤 이미지로 만든다.

```
화면 SVG ─▶ 색상 선택 ─▶ 사본 만들기 ─▶ 크기·여백 보정 ─▶ (흑백 인쇄용이면) 팔레트 색 적용 ─▶ <img>로 로드 ─▶ canvas ─▶ PNG/JPG
          (colorModeDialog.ts)                                    (svgPalette.ts)
```

## 사용법 (코드에서 호출)

```ts
import { exportStrategies, ExportCancelledError } from '../export/ExportStrategy';

const strategy = exportStrategies.find((s) => s.id === 'png'); // 'png' | 'jpg' | 'mermaid'
const blob = await strategy.export({ svg, code });             // 색상 선택 창이 뜸
const blob2 = await strategy.export({ svg, code, colorMode: 'grayscale' }); // 'grayscale' | 'original', 창 없이 바로
```

- `svg`: 렌더링된 SVG 문자열, `code`: Mermaid 코드, `colorMode`: PNG·JPG 색상 (생략하면 선택 창, .mmd는 무시)
- 다이어그램이 없으면(빈 SVG) 선택 창을 띄우기 전에 오류를 던진다.
- 선택 창에서 취소하면 `ExportCancelledError`를 던진다.
- `ExportSizeError`에는 `minWidth`(요구 폭)와 `maxWidth`(가능한 최대 폭)가 들어 있다.
- `RasterImageExport`를 직접 만들 때 `colorMode` 옵션(`'ask'` 기본값 | `'grayscale'` | `'original'`)으로 기본 동작을 정할 수 있다.
- 연결 코드: `src/ui/App.ts`의 `exportAs()`

## 주의할 점

- **Mermaid 버전 의존**: 클래스 상자가 `g.node`로 그려지고 색이 그 안의 도형에 들어간다는 것, 시퀀스 CSS 클래스 이름(`.actor`, `.note`, `.labelBox`, `.activationN`)에 기대고 있다. Mermaid 버전을 올리면 흑백 인쇄용 내보내기를 한 번 확인한다.
- **화면 색과 다름**: 흑백 인쇄용 이미지는 화면과 색이 다를 수 있다 (의도한 동작). 화면과 같은 색이 필요하면 "화면 색 그대로"를 고른다.
- **GUI 편집 결과 (확인 필요)**: 현재 `App.exportAs()`는 Mermaid 원본 SVG(`lastSvg`)를 넘긴다. 오버레이로 옮긴 노드 위치는 화면 캔버스의 SVG에만 반영되므로, 노드를 옮긴 뒤 내보내면 옮기기 전 위치로 나올 수 있다 (REQ-08 "화면과 위치 차이 1px 이내"와 관련). 내보내기 쪽은 넘겨받은 SVG를 그대로 쓰므로, UI에서 화면 SVG를 넘기면 해결된다. 이때 오버레이의 편집 핸들(■ 등)이 함께 찍히지 않는지 확인이 필요하다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `ExportStrategy.ts` (+ test) | 내보내기 Strategy (PNG/JPG/.mmd), 출력 크기 계산, foreignObject 대체 경로 |
| `colorModeDialog.ts` | PNG·JPG 색상 선택 창 (흑백 인쇄용 / 화면 색 그대로 / 취소) |
| `palette.ts` (+ test) | 4색 팔레트, 명도 계산, 가장 가까운 색 찾기, 코드에서 classDef·배경 색 읽기 |
| `svgPalette.ts` (+ test) | 흑백 인쇄용일 때 내보낼 SVG 사본의 상자 색·글자색 변경 |

## 테스트

`npm test`로 실행한다. 내보내기 테스트는 33개다.

| 파일 | 확인 내용 |
| --- | --- |
| `ExportStrategy.test.ts` | .mmd는 코드 그대로, 빈 다이어그램 오류, 2000px 확대, 비율 유지, 줄이지 않음, canvas 한계, `ExportSizeError`, 경계값 |
| `palette.test.ts` | 4색 명도 차이 20 이상, 글자 대비, 색 해석(hex·rgb·hsl·알파), 가까운 색 찾기, classDef·배경 색 대응표 |
| `svgPalette.test.ts` | 시퀀스 기본 상자 CSS 변환, 글자·화살표 규칙은 그대로 |

테스트 환경에 DOM이 없어서 색상 선택 창, SVG 노드 색 변경(`svgPalette.ts`), 이미지 만들기(canvas)는 자동 테스트가 없다. 브라우저에서 직접 확인한다.

1. 클래스 다이어그램에 `style Dog fill:#4a148c`를 넣는다.
2. PNG → **흑백 인쇄용**: Dog는 자주(c4)에 흰 글자, 색을 지정하지 않은 상자는 하늘(c2)
3. PNG → **화면 색 그대로**: 화면과 같은 색 (Dog 진보라, 나머지 연보라)
4. PNG → **취소**: 파일이 만들어지지 않고 상태 표시줄에 "내보내기를 취소했습니다."
5. Mermaid 코드 내보내기: 파일 내용이 입력한 코드와 같음
