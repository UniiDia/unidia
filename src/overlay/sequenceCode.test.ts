import { describe, expect, it } from 'vitest';
import { messageLineIndexes, moveMessage, reconnectMessage } from './sequenceCode';

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

describe('시퀀스 메시지 보낸이·받는이 바꾸기', () => {
  const code = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>+Alice: Hi\n  Bob->>Bob: Think\n';

  it('보낸이(start)나 받는이(end)를 바꾼다 — Alice->>Bob 을 Bob->>Carol 로', () => {
    const step1 = reconnectMessage(code, 0, 'start', 'Bob')!;
    expect(step1).toContain('  Bob->>Bob: Hello\n');
    expect(reconnectMessage(step1, 0, 'end', 'Carol')).toContain('  Bob->>Carol: Hello\n');
  });

  it('화살표 모양과 활성화 표시(+), 내용은 그대로 둔다', () => {
    expect(reconnectMessage(code, 1, 'end', 'Carol')).toContain('  Bob-->>+Carol: Hi\n');
  });

  it('자기 자신에게 보내는 메시지도 바꿀 수 있다', () => {
    expect(reconnectMessage(code, 2, 'end', 'Alice')).toContain('  Bob->>Alice: Think\n');
  });

  it('번호가 범위를 벗어나거나 바뀌는 게 없으면 null', () => {
    expect(reconnectMessage(code, 5, 'end', 'Carol')).toBeNull();
    expect(reconnectMessage(code, 0, 'end', 'Bob')).toBeNull();
  });
});
