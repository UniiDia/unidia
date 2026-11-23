import { describe, expect, it } from 'vitest';
import { parseEdgeKey, reconnectEdge } from './reconnect';

const CODE = `classDiagram
  class Animal {
    +String name
    +eat()
  }
  class Dog
  class Cat
  class Owner
  Animal <|-- Dog
  Owner "1" --> "*" Dog : owns
`;

describe('엣지 끝점 다시 연결', () => {
  it('끝(end)을 옮기면 관계 줄의 오른쪽 클래스가 바뀐다', () => {
    const next = reconnectEdge(CODE, { from: 'Animal', to: 'Dog', occurrence: 0 }, 'end', 'Cat');
    expect(next).toContain('  Animal <|-- Cat\n');
    expect(next).not.toContain('Animal <|-- Dog');
  });

  it('시작(start)을 옮기면 왼쪽 클래스가 바뀐다', () => {
    const next = reconnectEdge(CODE, { from: 'Animal', to: 'Dog', occurrence: 0 }, 'start', 'Owner');
    expect(next).toContain('  Owner <|-- Dog\n');
  });

  it('다중성 표기와 라벨은 그대로 둔다', () => {
    const next = reconnectEdge(CODE, { from: 'Owner', to: 'Dog', occurrence: 0 }, 'end', 'Cat');
    expect(next).toContain('  Owner "1" --> "*" Cat : owns\n');
  });

  it('클래스 정의나 멤버 줄은 건드리지 않는다', () => {
    const next = reconnectEdge(CODE, { from: 'Animal', to: 'Dog', occurrence: 0 }, 'end', 'Cat')!;
    expect(next.split('\n').filter((line) => line !== '  Animal <|-- Cat')).toEqual(
      CODE.split('\n').filter((line) => line !== '  Animal <|-- Dog'),
    );
  });

  it('같은 두 클래스 사이 선이 여러 개면 순번으로 고른다', () => {
    const code = 'classDiagram\n  A --> B : first\n  A --> B : second\n';
    expect(reconnectEdge(code, { from: 'A', to: 'B', occurrence: 1 }, 'end', 'C')).toBe(
      'classDiagram\n  A --> B : first\n  A --> C : second\n',
    );
  });

  it('여러 화살표 모양을 알아본다', () => {
    for (const arrow of ['<|--', '*--', 'o--', '-->', '--', '..>', '..|>', '..', '--|>', '--*', '--o']) {
      const code = `classDiagram\n  A ${arrow} B\n`;
      expect(reconnectEdge(code, { from: 'A', to: 'B', occurrence: 0 }, 'end', 'C')).toBe(
        `classDiagram\n  A ${arrow} C\n`,
      );
    }
  });

  it('제네릭 표기가 있는 클래스도 찾는다', () => {
    const code = 'classDiagram\n  List~T~ --> Item\n';
    expect(reconnectEdge(code, { from: 'List', to: 'Item', occurrence: 0 }, 'start', 'Box')).toBe(
      'classDiagram\n  Box --> Item\n',
    );
  });

  it('해당 관계 줄이 없으면 null', () => {
    expect(reconnectEdge(CODE, { from: 'Dog', to: 'Animal', occurrence: 0 }, 'end', 'Cat')).toBeNull();
    expect(reconnectEdge(CODE, { from: 'Animal', to: 'Dog', occurrence: 1 }, 'end', 'Cat')).toBeNull();
  });

  it('엣지 이름을 나눈다', () => {
    expect(parseEdgeKey('Owner->Dog#0')).toEqual({ from: 'Owner', to: 'Dog', occurrence: 0 });
    expect(parseEdgeKey('잘못된 이름')).toBeNull();
  });
});
