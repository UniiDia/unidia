/*
 * 엣지 끝점 다시 연결.
 * 클래스 다이어그램 코드에서 연결선에 해당하는 관계 줄을 찾아, 한쪽 클래스 이름을 바꾼다.
 * Mermaid는 관계 줄의 왼쪽 클래스에서 오른쪽 클래스로 선을 그리므로
 * 선의 시작(start) = 왼쪽 클래스, 끝(end) = 오른쪽 클래스다.
 *   예) Owner "1" --> "*" Dog : owns  →  끝(end)을 Cat으로 옮기면  Owner "1" --> "*" Cat : owns
 */

export interface EdgeRef {
  from: string;
  to: string;
  /* 같은 두 노드 사이 선 중 몇 번째인지 (0부터) */
  occurrence: number;
}

/* 클래스 이름 (제네릭 표기 ~T~ 포함) */
const NAME = String.raw`[A-Za-z_]\w*(?:~[^~\s]+~)?`;
/* 다중성 표기 "1", "*" (없어도 됨) */
const CARDINALITY = String.raw`(?:"[^"]*"\s*)?`;
/* 관계 화살표: <|-- *-- o-- --> -- ..> ..|> .. --|> --* --o 등 */
const ARROW = String.raw`(?:<\||\*|o|<)?(?:--|\.\.)(?:\|>|\*|o|>)?`;
const RELATION = new RegExp(
  String.raw`^(\s*)(${NAME})(\s*${CARDINALITY})(${ARROW})(\s*${CARDINALITY})(${NAME})(.*)$`,
);

/* "Owner->Dog#0" 같은 엣지 이름을 나눈다 (geometry.edgeKey의 반대) */
export function parseEdgeKey(key: string): EdgeRef | null {
  const match = /^(.+)->(.+)#(\d+)$/.exec(key);
  return match ? { from: match[1], to: match[2], occurrence: Number(match[3]) } : null;
}

/* 제네릭 표기를 뺀 클래스 이름 (Animal~T~ → Animal). 화면의 노드 이름과 비교할 때 쓴다. */
function baseName(name: string): string {
  return name.replace(/~[^~]*~$/, '');
}

/*
 * 코드에서 edge에 해당하는 관계 줄을 찾아 start(왼쪽) 또는 end(오른쪽) 클래스를 newNode로 바꾼 코드를 돌려준다.
 * 해당 줄을 찾지 못하면 null.
 */
export function reconnectEdge(
  code: string,
  edge: EdgeRef,
  end: 'start' | 'end',
  newNode: string,
): string | null {
  const lines = code.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('%%')) continue; // 주석
    const match = RELATION.exec(line);
    if (!match) continue;
    const [, indent, left, gapBefore, arrow, gapAfter, right, rest] = match;
    if (baseName(left) !== edge.from || baseName(right) !== edge.to) continue;
    if (seen++ !== edge.occurrence) continue;

    const newLeft = end === 'start' ? newNode : left;
    const newRight = end === 'end' ? newNode : right;
    lines[i] = `${indent}${newLeft}${gapBefore}${arrow}${gapAfter}${newRight}${rest}`;
    return lines.join('\n');
  }
  return null;
}
