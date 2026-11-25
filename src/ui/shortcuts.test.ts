import { describe, expect, it } from 'vitest';
import { type KeyInput, resolveShortcut, SHORTCUTS } from './shortcuts';

function key(k: string, mods: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput {
  return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('resolveShortcut', () => {
  it('Ctrl+Z는 실행 취소, Ctrl+Y와 Ctrl+Shift+Z는 다시 실행', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true }))).toBe('undo');
    expect(resolveShortcut(key('y', { ctrlKey: true }))).toBe('redo');
    expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('Ctrl+S는 저장, Ctrl+O는 불러오기', () => {
    expect(resolveShortcut(key('s', { ctrlKey: true }))).toBe('save');
    expect(resolveShortcut(key('o', { ctrlKey: true }))).toBe('open');
  });

  it('macOS의 Cmd 키도 Ctrl과 같게 처리한다', () => {
    expect(resolveShortcut(key('z', { metaKey: true }))).toBe('undo');
    expect(resolveShortcut(key('s', { metaKey: true }))).toBe('save');
  });

  it('Caps Lock 등으로 대문자가 와도 같은 동작이다', () => {
    expect(resolveShortcut(key('S', { ctrlKey: true }))).toBe('save');
    expect(resolveShortcut(key('Y', { ctrlKey: true }))).toBe('redo');
  });

  it('Ctrl 없이 누른 글자는 단축키가 아니다 (코드 입력을 막지 않는다)', () => {
    for (const k of ['z', 'y', 's', 'o']) expect(resolveShortcut(key(k))).toBeNull();
    expect(resolveShortcut(key('z', { shiftKey: true }))).toBeNull();
  });

  it('Ctrl+Alt 조합(AltGr 문자 입력)은 무시한다', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveShortcut(key('s', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('복사·붙여넣기·전체 선택은 브라우저 기본 동작에 맡긴다', () => {
    for (const k of ['c', 'v', 'x', 'a']) expect(resolveShortcut(key(k, { ctrlKey: true }))).toBeNull();
  });

  it('Shift가 붙은 Ctrl+Shift+S, Ctrl+Shift+O, Ctrl+Shift+Y는 정의하지 않는다', () => {
    expect(resolveShortcut(key('S', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key('O', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key('Y', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('키를 누르고 있으면 실행 취소는 반복되지만 저장·불러오기는 한 번만 된다', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true, repeat: true }))).toBe('undo');
    expect(resolveShortcut(key('y', { ctrlKey: true, repeat: true }))).toBe('redo');
    expect(resolveShortcut(key('s', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(resolveShortcut(key('o', { ctrlKey: true, repeat: true }))).toBeNull();
  });

  it('표시용 목록은 모든 동작을 한 번씩 포함한다', () => {
    const actions = SHORTCUTS.map((s) => s.action).sort();
    expect(actions).toEqual(['open', 'redo', 'save', 'undo']);
  });
});
