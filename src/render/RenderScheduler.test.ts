import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderResult } from './RenderEngine';
import { RenderScheduler } from './RenderScheduler';

const result = (svg: string): RenderResult => ({ svg, type: 'class' });

function deferred() {
  let resolve!: (result: RenderResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<RenderResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const render = vi.fn(async (code: string) => result(code));
  const callbacks = { onSuccess: vi.fn(), onError: vi.fn() };
  return { render, callbacks, scheduler: new RenderScheduler({ render }, callbacks) };
}

describe('RenderScheduler (REQ-01)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('연속 입력은 마지막 입력 후 150ms에 한 번만 렌더링한다', async () => {
    const { render, callbacks, scheduler } = setup();
    scheduler.request('first');
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request('latest');
    await vi.advanceTimersByTimeAsync(149);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(render.mock.calls).toEqual([['latest']]);
    expect(callbacks.onSuccess).toHaveBeenCalledWith(result('latest'), 100);
  });

  it('첫 렌더는 지연 없이 실행할 수 있다', async () => {
    const { render, callbacks, scheduler } = setup();
    scheduler.request('initial', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(render.mock.calls).toEqual([['initial']]);
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
  });

  it('새 입력의 debounce 중에도 이전 결과를 표시하지 않는다', async () => {
    const { render, callbacks, scheduler } = setup();
    const old = deferred();
    render.mockReturnValueOnce(old.promise);
    scheduler.request('old', true);
    await vi.advanceTimersByTimeAsync(50);
    scheduler.request('new');
    old.resolve(result('old'));
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(callbacks.onSuccess.mock.calls).toEqual([[result('new'), 50]]);
  });

  it('느린 렌더 뒤에는 최신 요청만 남기고 동시에 실행하지 않는다', async () => {
    const { render, callbacks, scheduler } = setup();
    const old = deferred();
    render.mockReturnValueOnce(old.promise);
    scheduler.request('old', true);
    scheduler.request('middle');
    await vi.advanceTimersByTimeAsync(200);
    scheduler.request('latest');
    await vi.advanceTimersByTimeAsync(200);
    expect(render).toHaveBeenCalledTimes(1);
    old.resolve(result('old'));
    await vi.advanceTimersByTimeAsync(0);
    expect(render.mock.calls.map(([code]) => code)).toEqual(['old', 'latest']);
    expect(callbacks.onSuccess.mock.calls).toEqual([[result('latest'), 200]]);
  });

  it('이전 요청의 오류로 최신 화면을 덮어쓰지 않는다', async () => {
    const { render, callbacks, scheduler } = setup();
    const old = deferred();
    render.mockReturnValueOnce(old.promise);
    scheduler.request('invalid', true);
    scheduler.request('fixed');
    old.reject(new Error('old syntax error'));
    await vi.advanceTimersByTimeAsync(150);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onSuccess.mock.calls).toEqual([[result('fixed'), 0]]);
  });

  it('현재 오류를 알린 뒤에도 다음 입력을 렌더링한다', async () => {
    const { render, callbacks, scheduler } = setup();
    const error = new Error('syntax error');
    render.mockRejectedValueOnce(error);
    scheduler.request('invalid', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onError.mock.calls).toEqual([[error]]);
    scheduler.request('fixed');
    await vi.advanceTimersByTimeAsync(150);
    expect(callbacks.onSuccess).toHaveBeenCalledWith(result('fixed'), 0);
  });

  it('해제하면 진행 중 결과와 대기 요청을 모두 버린다', async () => {
    const { render, callbacks, scheduler } = setup();
    const old = deferred();
    render.mockReturnValueOnce(old.promise);
    scheduler.request('running', true);
    scheduler.request('pending');
    scheduler.dispose();
    old.resolve(result('running'));
    scheduler.request('after dispose');
    await vi.advanceTimersByTimeAsync(1000);
    expect(render).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
