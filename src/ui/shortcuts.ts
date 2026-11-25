/**
 * 단축키 → 동작 매핑 (REQ-11, 트래커 RQ-10).
 * 키 입력을 동작 이름으로만 바꾸고, 실제 실행은 App이 한다. DOM 없이 단위 테스트할 수 있다.
 *
 * Ctrl+C / Ctrl+V / Ctrl+A는 코드 편집 영역의 브라우저 기본 동작(복사·붙여넣기·전체 선택)을 그대로 쓴다.
 * 캔버스 객체 복사·붙여넣기는 SRS에 정의되어 있지 않아 여기서 가로채지 않는다.
 */
export type ShortcutAction = 'undo' | 'redo' | 'save' | 'open';

/** KeyboardEvent에서 필요한 값만 뽑은 형태 (테스트에서 객체로 바로 만들 수 있다). */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

export interface ShortcutInfo {
  action: ShortcutAction;
  /** 버튼 라벨·도움말에 쓰는 표기 */
  keys: string;
  label: string;
}

/** 화면 표시용 목록. resolveShortcut과 같은 내용을 유지한다. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { action: 'undo', keys: 'Ctrl+Z', label: '실행 취소' },
  { action: 'redo', keys: 'Ctrl+Y / Ctrl+Shift+Z', label: '다시 실행' },
  { action: 'save', keys: 'Ctrl+S', label: '저장' },
  { action: 'open', keys: 'Ctrl+O', label: '불러오기' },
];

/**
 * 키 입력을 동작으로 바꾼다. 해당하는 단축키가 없으면 null.
 * - Ctrl(Windows) 또는 Cmd(macOS)가 눌려 있어야 한다.
 * - Alt가 함께 눌리면 무시한다 (Ctrl+Alt 조합은 일부 키보드에서 AltGr 문자 입력이다).
 * - 저장·불러오기는 키를 누르고 있을 때 반복 실행하지 않는다. 실행 취소·다시 실행은 반복을 허용한다.
 */
export function resolveShortcut(input: KeyInput): ShortcutAction | null {
  if (!(input.ctrlKey || input.metaKey) || input.altKey) return null;
  const key = input.key.toLowerCase();

  if (key === 'z') return input.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !input.shiftKey) return 'redo';
  if (input.repeat) return null;
  if (key === 's' && !input.shiftKey) return 'save';
  if (key === 'o' && !input.shiftKey) return 'open';
  return null;
}
