import { describe, expect, it } from 'vitest';
import { CommandHistory, MoveNodeCommand, SetCodeCommand, SetEdgePathCommand } from './Command';
import { DiagramModel } from './DiagramModel';

describe('CommandHistory (REQ-11)', () => {
  it('코드 수정을 실행 취소하고 다시 실행한다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    history.execute(new SetCodeCommand(model, 'a', 'b'));
    expect(model.getState().code).toBe('b');

    expect(history.undo()).toBe(true);
    expect(model.getState().code).toBe('a');

    expect(history.redo()).toBe(true);
    expect(model.getState().code).toBe('b');
  });

  it('노드 이동을 실행 취소하면 이전 위치로, 처음 이동이면 시각 정보가 사라진다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    history.execute(new MoveNodeCommand(model, 'n1', { x: 1, y: 1 }));
    history.execute(new MoveNodeCommand(model, 'n1', { x: 5, y: 5 }));

    history.undo();
    expect(model.getState().nodeLayouts['n1']).toEqual({ x: 1, y: 1 });
    history.undo();
    expect(model.getState().nodeLayouts['n1']).toBeUndefined();
  });

  it('새 편집을 하면 다시 실행 기록이 지워진다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    history.execute(new SetCodeCommand(model, 'a', 'b'));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(new SetCodeCommand(model, 'a', 'c'));
    expect(history.canRedo).toBe(false);
  });

  it('기록이 없으면 undo/redo는 false를 돌려준다', () => {
    const history = new CommandHistory();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('드래그가 끝난 뒤 기록해도 prev로 시작 위치를 넘기면 그 위치로 되돌아간다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    model.setNodeLayout('n1', { x: 1, y: 1 });

    // 드래그 중: 오버레이가 모델을 직접 바꿔 미리보기를 보여준다
    const start = model.getState().nodeLayouts['n1'];
    model.setNodeLayout('n1', { x: 7, y: 7 });
    model.setNodeLayout('n1', { x: 9, y: 9 });

    // 드래그 끝: 한 번의 편집으로 기록한다
    history.execute(new MoveNodeCommand(model, 'n1', { x: 9, y: 9 }, { prev: start }));
    expect(model.getState().nodeLayouts['n1']).toEqual({ x: 9, y: 9 });

    history.undo();
    expect(model.getState().nodeLayouts['n1']).toEqual({ x: 1, y: 1 });
    expect(history.canUndo).toBe(false);
  });

  it('prev: undefined를 넘기면 처음 이동으로 보고 undo 시 시각 정보가 사라진다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    model.setNodeLayout('n1', { x: 4, y: 4 }); // 드래그 중 미리보기
    history.execute(new MoveNodeCommand(model, 'n1', { x: 4, y: 4 }, { prev: undefined }));
    history.undo();
    expect(model.getState().nodeLayouts['n1']).toBeUndefined();
  });

  it('엣지 경로 수정을 실행 취소하고 다시 실행한다 (REQ-05)', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    const first = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const second = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }];
    history.execute(new SetEdgePathCommand(model, 'e1', first));
    history.execute(new SetEdgePathCommand(model, 'e1', second));

    history.undo();
    expect(model.getState().edgePaths['e1']).toEqual(first);
    history.undo();
    expect(model.getState().edgePaths['e1']).toBeUndefined();
    history.redo();
    expect(model.getState().edgePaths['e1']).toEqual(first);
  });

  it('clear()하면 실행 취소·다시 실행 기록이 모두 사라진다', () => {
    const model = new DiagramModel({ code: 'a' });
    const history = new CommandHistory();
    history.execute(new SetCodeCommand(model, 'a', 'b'));
    history.execute(new SetCodeCommand(model, 'b', 'c'));
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
