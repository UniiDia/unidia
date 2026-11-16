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

export class MoveNodeCommand implements Command {
  private prev: NodeLayout | undefined;

  constructor(
    private model: DiagramModel,
    private nodeId: string,
    private next: NodeLayout,
  ) {
    this.prev = model.getState().nodeLayouts[nodeId];
  }

  execute(): void {
    this.model.setNodeLayout(this.nodeId, this.next);
  }

  undo(): void {
    this.model.setNodeLayout(this.nodeId, this.prev);
  }
}

/** 연결선 꺾임점 추가·이동·삭제 (REQ-05). next가 undefined면 꺾임점을 모두 지운다. */
export class SetEdgePathCommand implements Command {
  private prev: Point[] | undefined;

  constructor(
    private model: DiagramModel,
    private edgeId: string,
    private next: Point[] | undefined,
  ) {
    this.prev = model.getState().edgePaths[edgeId];
  }

  execute(): void {
    this.model.setEdgePath(this.edgeId, this.next);
  }

  undo(): void {
    this.model.setEdgePath(this.edgeId, this.prev);
  }
}
