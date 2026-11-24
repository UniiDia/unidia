import { describe, expect, it } from 'vitest';
import { detectDiagramType } from './diagramTypes';

describe('detectDiagramType (REQ-07)', () => {
  it('클래스·시퀀스 다이어그램을 판별한다', () => {
    expect(detectDiagramType('classDiagram\n  A <|-- B')).toBe('class');
    expect(detectDiagramType('sequenceDiagram\n  A->>B: hi')).toBe('sequence');
  });

  it('앞의 빈 줄과 주석은 건너뛴다', () => {
    expect(detectDiagramType('\n%% 주석\n  classDiagram\n')).toBe('class');
  });

  it('지원하지 않는 유형이나 빈 입력은 null', () => {
    expect(detectDiagramType('flowchart TD\n A-->B')).toBeNull();
    expect(detectDiagramType('')).toBeNull();
    expect(detectDiagramType('%% 주석만')).toBeNull();
  });

  it.each([
    ['\uFEFF\r\n%% 한글 주석\r\nclassDiagram\r\nclass 사용자', 'class'],
    [' \n%% 첫 주석\n%% 두 번째 주석\nsequenceDiagram\nA->>B: hi', 'sequence'],
    ['classDiagram; A <|-- B', 'class'],
    ['classDiagram-v2\nclass A', 'class'],
    ['---\ntitle: 수강 신청\nconfig:\n  theme: neutral\n---\nclassDiagram\nclass 학생', 'class'],
    ['---\r\ntitle: 요청\r\n---\r\n%% 설명\r\nsequenceDiagram\r\nA->>B: 요청', 'sequence'],
    ['%%{init: {\n  "theme": "neutral"\n}}%%\nsequenceDiagram\nA->>B: hi', 'sequence'],
  ])('주석·메타데이터가 있는 유효한 헤더를 처리한다: %s', (code, expected) => {
    expect(detectDiagramType(code)).toBe(expected);
  });

  it.each([
    ' \t\r\n',
    '%% 주석\n%% 다른 주석\n',
    'flowchart TD\nA-->B',
    'graph LR\nA-->B',
    'stateDiagram-v2\n[*] --> A',
    'erDiagram\nUSER ||--o{ ORDER : places',
    'classDiagramWrong\nclass A',
    'sequenceDiagramXYZ\nA->>B: hi',
    '---\ntitle: 닫히지 않은 메타데이터\nclassDiagram',
    '%%{init: {\n"theme": "neutral"\nsequenceDiagram',
  ])('빈 입력·미지원 유형·잘못된 헤더는 거절한다: %s', (code) => {
    expect(detectDiagramType(code)).toBeNull();
  });
});
