import { describe, expect, it } from 'vitest';
import { CommandHistory, SetCodeCommand, SetEdgePathCommand } from '../core/Command';
import { DiagramModel } from '../core/DiagramModel';
import { BatchCommand } from './BatchCommand';

describe('BatchCommand', () => {
  it('묶은 편집을 실행 취소 한 번에 모두 되돌린다', () => {
    const model = new DiagramModel({ code: 'a', edgePaths: { 'seq:A->B#0': [{ x: 0, y: 10 }] } });
    const history = new CommandHistory();
    history.execute(
      new BatchCommand([
        new SetCodeCommand(model, 'a', 'b'),
        new SetEdgePathCommand(model, 'seq:A->B#0', undefined),
      ]),
    );
    expect(model.getState().code).toBe('b');
    expect(model.getState().edgePaths['seq:A->B#0']).toBeUndefined();

    history.undo();
    expect(model.getState().code).toBe('a');
    expect(model.getState().edgePaths['seq:A->B#0']).toEqual([{ x: 0, y: 10 }]);

    history.redo();
    expect(model.getState().code).toBe('b');
  });
});
