/*
 * 시퀀스 다이어그램 메시지 순서 바꾸기.
 * 시퀀스에서는 메시지 순서(=시간 순서)가 곧 코드에 적힌 순서라, 순서를 바꾸려면 코드의 메시지 줄을 옮겨야 한다.
 * Mermaid는 메시지를 코드에 적힌 순서대로 그리므로, 화면의 n번째 메시지 = 코드의 n번째 메시지 줄이다.
 *   예) moveMessage(code, 1, 0): 두 번째 메시지 줄을 첫 번째 메시지 줄 앞으로 옮긴다.
 */

/* 참여자 이름: 공백·콜론·화살표 기호가 없는 글자들 (한글 이름 포함) */
const NAME = String.raw`[^\s:;<>+()\-]+`;
/* 메시지 화살표 (긴 것부터): <<-->> <<->> -->> ->> --x -x --) -) --> -> */
const ARROW = String.raw`(?:<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)`;
/* "보낸이 화살표 [+/-]받는이 : 내용" */
const MESSAGE = new RegExp(String.raw`^\s*${NAME}\s*${ARROW}\s*[+-]?\s*${NAME}\s*:`);
/* 같은 형식을 [들여쓰기, 보낸이, 화살표 부분, 받는이, 나머지]로 나눠 읽는다 */
const MESSAGE_PARTS = new RegExp(String.raw`^(\s*)(${NAME})(\s*${ARROW}\s*[+-]?\s*)(${NAME})(\s*:.*)$`);

/* 코드에서 메시지 줄이 몇 번째 줄인지 목록 */
export function messageLineIndexes(code: string): number[] {
  return code
    .split('\n')
    .map((line, i) => (MESSAGE.test(line) && !line.trim().startsWith('%%') ? i : -1))
    .filter((i) => i >= 0);
}

/*
 * from번째 메시지를 to번째 자리로 옮긴 코드를 돌려준다 (둘 다 0부터, 메시지끼리 센 순서).
 * 옮긴 줄의 들여쓰기는 새 자리의 이웃 메시지에 맞춘다 (loop/alt 블록 안팎으로 옮길 때 보기 좋게).
 * 번호가 범위를 벗어나거나 같으면 null.
 */
export function moveMessage(code: string, from: number, to: number): string | null {
  const lines = code.split('\n');
  const indexes = messageLineIndexes(code);
  if (from === to || from < 0 || to < 0 || from >= indexes.length || to >= indexes.length) return null;

  const source = indexes[from];
  const target = indexes[to];
  const indent = (line: string) => /^\s*/.exec(line)![0];
  const moved = indent(lines[target]) + lines[source].trimStart();

  lines.splice(source, 1);
  /*
   * 같은 자리(target)에 넣으면 된다:
   * - 앞으로 옮길 때(to < from): 대상 줄은 지운 줄보다 앞이라 자리가 그대로 → 대상 줄 "앞"에 들어감
   * - 뒤로 옮길 때(to > from): 지운 줄 때문에 대상 줄이 한 칸 당겨짐 → 대상 줄 "뒤"에 들어감
   */
  lines.splice(target, 0, moved);
  return lines.join('\n');
}

/*
 * index번째 메시지의 보낸이(start) 또는 받는이(end)를 participant로 바꾼 코드를 돌려준다.
 *   예) Alice->>Bob: Hello 에서 받는이를 Carol로  →  Alice->>Carol: Hello
 * 화살표 모양·활성화 표시(+/-)·내용은 그대로 둔다. 찾지 못하거나 바뀌는 게 없으면 null.
 */
export function reconnectMessage(
  code: string,
  index: number,
  end: 'start' | 'end',
  participant: string,
): string | null {
  const lines = code.split('\n');
  const indexes = messageLineIndexes(code);
  if (index < 0 || index >= indexes.length) return null;
  const lineIndex = indexes[index];
  const match = MESSAGE_PARTS.exec(lines[lineIndex]);
  if (!match) return null;
  const [, indent, sender, arrow, receiver, rest] = match;
  const next =
    end === 'start'
      ? `${indent}${participant}${arrow}${receiver}${rest}`
      : `${indent}${sender}${arrow}${participant}${rest}`;
  if (next === lines[lineIndex]) return null;
  lines[lineIndex] = next;
  return lines.join('\n');
}
