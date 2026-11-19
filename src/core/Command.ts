import type { DiagramModel, NodeLayout, Point } from './DiagramModel';

/** Command 패턴: 편집 동작을 객체로 만들어 실행 취소/재실행을 지원한다 (REQ-11). */
export interface Command {
  execute(): void;
  undo(): void;
}

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
    return true;
  }

  /** 기록을 모두 지운다. 파일을 불러온 뒤처럼 이전 편집을 되돌리면 안 될 때 쓴다. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export class SetCodeCommand implements Command {
  constructor(
    private model: DiagramModel,
    private prev: string,
    private next: string,
  ) {}

  execute(): void {
    this.model.setCode(this.next);
  }

  undo(): void {
    this.model.setCode(this.prev);
  }
}

/**
 * 노드 이동.
 * 드래그 중에는 오버레이가 모델을 직접 바꿔 미리보기를 보여주므로, 드래그가 끝난 뒤
 * Command를 만들 때는 모델에서 읽은 값이 이미 이동된 위치다. 그래서 드래그를 시작할 때의
 * 위치를 options.prev로 넘긴다 (처음 이동이면 prev: undefined).
 * options를 생략하면 생성 시점의 모델 값을 이전 위치로 쓴다.
 */
export class MoveNodeCommand implements Command {
  private prev: NodeLayout | undefined;

  constructor(
    private model: DiagramModel,
    private nodeId: string,
    private next: NodeLayout,
    options?: { prev?: NodeLayout },
  ) {
    this.prev =
      options && 'prev' in options ? options.prev : model.getState().nodeLayouts[nodeId];
  }

  execute(): void {
    this.model.setNodeLayout(this.nodeId, this.next);
  }

  undo(): void {
    this.model.setNodeLayout(this.nodeId, this.prev);
  }
}

/** 엣지 경로 수정 (REQ-05). prev 규칙은 MoveNodeCommand와 같다. */
export class SetEdgePathCommand implements Command {
  private prev: Point[] | undefined;

  constructor(
    private model: DiagramModel,
    private edgeId: string,
    private next: Point[] | undefined,
    options?: { prev?: Point[] },
  ) {
    this.prev =
      options && 'prev' in options ? options.prev : model.getState().edgePaths[edgeId];
  }

  execute(): void {
    this.model.setEdgePath(this.edgeId, this.next);
  }

  undo(): void {
    this.model.setEdgePath(this.edgeId, this.prev);
  }
}
