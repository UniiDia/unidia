import { describe, expect, it } from 'vitest';
import { messageLineIndexes, moveMessage } from './sequenceCode';

const CODE = `sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello Bob
  Bob-->>Alice: Hi
  Note right of Bob: note
  Bob->>Bob: Think
`;

describe('시퀀스 메시지 순서 바꾸기', () => {
  it('메시지 줄만 골라낸다 (참여자·노트 줄은 제외)', () => {
    expect(messageLineIndexes(CODE)).toEqual([3, 4, 6]);
  });

  it('뒤 메시지를 앞으로 옮긴다', () => {
    expect(moveMessage(CODE, 1, 0)).toBe(`sequenceDiagram
  participant Alice
  participant Bob
  Bob-->>Alice: Hi
  Alice->>Bob: Hello Bob
  Note right of Bob: note
  Bob->>Bob: Think
`);
  });

  it('앞 메시지를 맨 뒤로 옮긴다 (노트는 제자리)', () => {
    expect(moveMessage(CODE, 0, 2)).toBe(`sequenceDiagram
  participant Alice
  participant Bob
  Bob-->>Alice: Hi
  Note right of Bob: note
  Bob->>Bob: Think
  Alice->>Bob: Hello Bob
`);
  });

  it('여러 화살표 모양과 활성화 표시(+/-), 한글 이름을 알아본다', () => {
    const code = 'sequenceDiagram\n  사용자->>+서버: 요청\n  서버-->>-사용자: 응답\n  A-xB: 실패\n  A-)B: 비동기\n  A<<->>B: 양방향\n';
    expect(messageLineIndexes(code)).toEqual([1, 2, 3, 4, 5]);
    expect(moveMessage(code, 4, 0)).toBe(
      'sequenceDiagram\n  A<<->>B: 양방향\n  사용자->>+서버: 요청\n  서버-->>-사용자: 응답\n  A-xB: 실패\n  A-)B: 비동기\n',
    );
  });

  it('loop 블록 안으로 옮기면 들여쓰기를 맞춘다', () => {
    const code = 'sequenceDiagram\n  A->>B: one\n  loop every minute\n    B->>A: two\n  end\n';
    expect(moveMessage(code, 0, 1)).toBe('sequenceDiagram\n  loop every minute\n    B->>A: two\n    A->>B: one\n  end\n');
  });

  it('번호가 같거나 범위를 벗어나면 null', () => {
    expect(moveMessage(CODE, 1, 1)).toBeNull();
    expect(moveMessage(CODE, 0, 5)).toBeNull();
    expect(moveMessage(CODE, -1, 0)).toBeNull();
  });
});
