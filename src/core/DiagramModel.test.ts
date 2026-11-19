import { describe, expect, it, vi } from 'vitest';
import { DiagramModel } from './DiagramModel';

describe('DiagramModel', () => {
  it('코드가 바뀌면 구독자에게 알린다', () => {
    const model = new DiagramModel({ code: 'a' });
    const listener = vi.fn();
    model.subscribe(listener);
    model.setCode('b');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].code).toBe('b');
  });

  it('같은 코드면 알리지 않는다', () => {
    const model = new DiagramModel({ code: 'a' });
    const listener = vi.fn();
    model.subscribe(listener);
    model.setCode('a');
    expect(listener).not.toHaveBeenCalled();
  });

  it('구독 해제 후에는 알리지 않는다', () => {
    const model = new DiagramModel();
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    unsubscribe();
    model.setCode('x');
    expect(listener).not.toHaveBeenCalled();
  });

  it('코드를 수정해도 GUI 시각 정보가 유지된다 (REQ-03)', () => {
    const model = new DiagramModel({ code: 'a' });
    model.setNodeLayout('n1', { x: 10, y: 20 });
    model.setEdgePath('e1', [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    model.setCode('b');
    expect(model.getState().nodeLayouts['n1']).toEqual({ x: 10, y: 20 });
    expect(model.getState().edgePaths['e1']).toHaveLength(2);
  });

  it('JSON으로 저장하고 불러오면 동일하게 복원된다 (REQ-12)', () => {
    const model = new DiagramModel({ code: 'classDiagram' });
    model.setNodeLayout('n1', { x: 1, y: 2, width: 30, height: 40 });
    model.setEdgePath('e1', [{ x: 1, y: 1 }]);
    const restored = DiagramModel.fromJSON(model.toJSON());
    expect(restored.getState()).toEqual(model.getState());
  });

  it('형식이 맞지 않는 파일은 불러오기에 실패한다', () => {
    expect(() => DiagramModel.fromJSON('{"foo": 1}')).toThrow();
    expect(() => DiagramModel.fromJSON('not json')).toThrow();
  });

  it('같은 노드 위치·엣지 경로면 알리지 않는다', () => {
    const model = new DiagramModel({ code: 'a' });
    model.setNodeLayout('n1', { x: 1, y: 2 });
    model.setEdgePath('e1', [{ x: 0, y: 0 }]);
    const listener = vi.fn();
    model.subscribe(listener);

    model.setNodeLayout('n1', { x: 1, y: 2 });
    model.setEdgePath('e1', [{ x: 0, y: 0 }]);
    model.setNodeLayout('none', undefined);
    expect(listener).not.toHaveBeenCalled();

    model.setNodeLayout('n1', { x: 3, y: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('load()는 구독을 유지한 채 상태를 바꾸고 구독자에게 알린다 (REQ-12)', () => {
    const source = new DiagramModel({ code: 'classDiagram' });
    source.setNodeLayout('n1', { x: 1, y: 2 });
    const target = new DiagramModel({ code: 'old' });
    const listener = vi.fn();
    target.subscribe(listener);

    target.load(source.toJSON());
    expect(target.getState()).toEqual(source.getState());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('load()가 실패하면 기존 상태가 그대로 유지된다', () => {
    const model = new DiagramModel({ code: 'keep' });
    const listener = vi.fn();
    model.subscribe(listener);
    expect(() => model.load('{"foo": 1}')).toThrow();
    expect(model.getState().code).toBe('keep');
    expect(listener).not.toHaveBeenCalled();
  });

  it('지원하지 않는 버전이나 잘못된 위치·경로 형식은 불러오기에 실패한다', () => {
    expect(() => DiagramModel.fromJSON('{"version": 2, "code": "a"}')).toThrow();
    expect(() => DiagramModel.fromJSON('{"code": "a", "nodeLayouts": []}')).toThrow();
    expect(() => DiagramModel.fromJSON('{"code": "a", "nodeLayouts": {"n1": {"x": "1", "y": 2}}}')).toThrow();
    expect(() => DiagramModel.fromJSON('{"code": "a", "edgePaths": {"e1": [{"x": 1}]}}')).toThrow();
    expect(() => DiagramModel.fromJSON('null')).toThrow();
  });

  it('version 필드가 없는 파일도 불러온다', () => {
    const model = DiagramModel.fromJSON('{"code": "a"}');
    expect(model.getState()).toEqual({ code: 'a', nodeLayouts: {}, edgePaths: {} });
  });
});
