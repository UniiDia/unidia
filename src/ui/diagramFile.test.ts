import { describe, expect, it } from 'vitest';
import { CommandHistory, MoveNodeCommand, SetCodeCommand } from '../core/Command';
import { DiagramModel } from '../core/DiagramModel';
import {
  checkDiagramFileSize,
  diagramFileContent,
  loadDiagramFile,
  MAX_DIAGRAM_FILE_BYTES,
} from './diagramFile';

const CODE = 'classDiagram\n  A <|-- B\n';

function editedModel(): { model: DiagramModel; history: CommandHistory } {
  const model = new DiagramModel({ code: CODE });
  const history = new CommandHistory();
  history.execute(new MoveNodeCommand(model, 'A', { x: 10, y: 20, width: 120, height: 60 }));
  model.setEdgePath('A->B', [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  return { model, history };
}

describe('diagramFile', () => {
  it('저장한 파일을 불러오면 코드·노드 위치·크기·엣지 경로가 같게 복원된다 (REQ-12 확인 기준)', () => {
    const { model } = editedModel();
    const saved = diagramFileContent(model);

    const target = new DiagramModel({ code: 'sequenceDiagram\n  A->>B: hi\n' });
    const result = loadDiagramFile(target, new CommandHistory(), saved);

    expect(result).toEqual({ ok: true });
    expect(target.getState()).toEqual(model.getState());
  });

  it('불러오면 편집 기록을 비워 이전 편집으로 되돌아가지 않는다', () => {
    const { model, history } = editedModel();
    history.execute(new SetCodeCommand(model, CODE, 'classDiagram\n  C\n'));
    expect(history.canUndo).toBe(true);

    loadDiagramFile(model, history, JSON.stringify({ version: 1, code: CODE }));

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(model.getState().code).toBe(CODE);
  });

  it('불러오면 구독자(화면)에게 알린다', () => {
    const model = new DiagramModel({ code: 'old' });
    const seen: string[] = [];
    model.subscribe((state) => seen.push(state.code));

    loadDiagramFile(model, new CommandHistory(), JSON.stringify({ code: CODE }));

    expect(seen).toEqual([CODE]);
  });

  it('JSON이 아닌 파일은 실패하고 모델과 편집 기록을 그대로 둔다', () => {
    const { model, history } = editedModel();
    const before = model.getState();

    const result = loadDiagramFile(model, history, 'not json');

    expect(result).toEqual({ ok: false, message: '불러오지 못했습니다: JSON 형식이 아닌 파일입니다.' });
    expect(model.getState()).toBe(before);
    expect(history.canUndo).toBe(true);
  });

  it('형식이 틀린 UniDia 파일은 core의 검사 메시지를 보여준다', () => {
    const { model, history } = editedModel();

    const noCode = loadDiagramFile(model, history, JSON.stringify({ nodeLayouts: {} }));
    const badVersion = loadDiagramFile(model, history, JSON.stringify({ version: 99, code: CODE }));

    expect(noCode.ok).toBe(false);
    expect(!noCode.ok && noCode.message).toContain('code 필드가 없습니다');
    expect(badVersion.ok).toBe(false);
    expect(!badVersion.ok && badVersion.message).toContain('지원하지 않는 파일 버전');
    expect(history.canUndo).toBe(true);
  });

  it('빈 파일과 너무 큰 파일은 읽기 전에 막는다', () => {
    expect(checkDiagramFileSize(0)).toBe('빈 파일입니다.');
    expect(checkDiagramFileSize(MAX_DIAGRAM_FILE_BYTES + 1)).toContain('5MB 이하');
    expect(checkDiagramFileSize(1024)).toBeNull();
    expect(checkDiagramFileSize(MAX_DIAGRAM_FILE_BYTES)).toBeNull();
  });
});
