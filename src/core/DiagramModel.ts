import { Observable } from './Observable';

export interface Point {
  x: number;
  y: number;
}

export interface NodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * 다이어그램 상태.
 * - code: 논리 구조 (Mermaid 코드)
 * - nodeLayouts / edgePaths: GUI에서 편집한 시각 정보. 코드와 별도로 관리하며
 *   코드를 수정해도 유지된다 (REQ-03, SRS 3.4).
 */
export interface DiagramState {
  code: string;
  nodeLayouts: Record<string, NodeLayout>;
  edgePaths: Record<string, Point[]>;
}

const FILE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isNodeLayout(value: unknown): value is NodeLayout {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return false;
  return (
    (value.width === undefined || isFiniteNumber(value.width)) &&
    (value.height === undefined || isFiniteNumber(value.height))
  );
}

function sameLayout(a: NodeLayout | undefined, b: NodeLayout | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function samePath(a: Point[] | undefined, b: Point[] | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/** JSON 문자열을 검사해 DiagramState로 바꾼다. 형식이 맞지 않으면 예외를 던진다 (REQ-12). */
function parseState(json: string): DiagramState {
  const data: unknown = JSON.parse(json);
  if (!isRecord(data) || typeof data.code !== 'string') {
    throw new Error('올바른 UniDia 파일이 아닙니다: code 필드가 없습니다');
  }
  if (data.version !== undefined && data.version !== FILE_VERSION) {
    throw new Error(`지원하지 않는 파일 버전입니다: ${String(data.version)}`);
  }

  const nodeLayouts: Record<string, NodeLayout> = {};
  if (data.nodeLayouts !== undefined) {
    if (!isRecord(data.nodeLayouts)) throw new Error('올바른 UniDia 파일이 아닙니다: nodeLayouts 형식 오류');
    for (const [id, layout] of Object.entries(data.nodeLayouts)) {
      if (!isNodeLayout(layout)) throw new Error(`올바른 UniDia 파일이 아닙니다: 노드 "${id}"의 위치 형식 오류`);
      nodeLayouts[id] = layout;
    }
  }

  const edgePaths: Record<string, Point[]> = {};
  if (data.edgePaths !== undefined) {
    if (!isRecord(data.edgePaths)) throw new Error('올바른 UniDia 파일이 아닙니다: edgePaths 형식 오류');
    for (const [id, points] of Object.entries(data.edgePaths)) {
      if (!Array.isArray(points) || !points.every(isPoint)) {
        throw new Error(`올바른 UniDia 파일이 아닙니다: 엣지 "${id}"의 경로 형식 오류`);
      }
      edgePaths[id] = points;
    }
  }

  return { code: data.code, nodeLayouts, edgePaths };
}

export class DiagramModel extends Observable<Readonly<DiagramState>> {
  private state: DiagramState;

  constructor(initial?: Partial<DiagramState>) {
    super();
    this.state = {
      code: initial?.code ?? '',
      nodeLayouts: { ...(initial?.nodeLayouts ?? {}) },
      edgePaths: { ...(initial?.edgePaths ?? {}) },
    };
  }

  getState(): Readonly<DiagramState> {
    return this.state;
  }

  setCode(code: string): void {
    if (code === this.state.code) return;
    this.state = { ...this.state, code };
    this.emit(this.state);
  }

  /** layout이 undefined면 해당 노드의 시각 정보를 지운다. */
  setNodeLayout(nodeId: string, layout: NodeLayout | undefined): void {
    if (sameLayout(this.state.nodeLayouts[nodeId], layout)) return;
    const nodeLayouts = { ...this.state.nodeLayouts };
    if (layout) nodeLayouts[nodeId] = layout;
    else delete nodeLayouts[nodeId];
    this.state = { ...this.state, nodeLayouts };
    this.emit(this.state);
  }

  setEdgePath(edgeId: string, points: Point[] | undefined): void {
    if (samePath(this.state.edgePaths[edgeId], points)) return;
    const edgePaths = { ...this.state.edgePaths };
    if (points) edgePaths[edgeId] = points;
    else delete edgePaths[edgeId];
    this.state = { ...this.state, edgePaths };
    this.emit(this.state);
  }

  /** 저장 (REQ-12). */
  toJSON(): string {
    return JSON.stringify({ version: FILE_VERSION, ...this.state }, null, 2);
  }

  /**
   * 불러오기 (REQ-12). 이 모델의 상태를 파일 내용으로 바꾸고 구독자에게 알린다.
   * 구독 연결(UI, 렌더러)이 유지된다. 형식이 맞지 않으면 예외를 던지고 상태는 그대로다.
   * 불러온 뒤에는 CommandHistory.clear()로 이전 편집 기록을 지우는 것을 권장한다.
   */
  load(json: string): void {
    this.state = parseState(json);
    this.emit(this.state);
  }

  /** 새 모델로 불러오기. 형식이 맞지 않으면 예외를 던진다. */
  static fromJSON(json: string): DiagramModel {
    return new DiagramModel(parseState(json));
  }
}
