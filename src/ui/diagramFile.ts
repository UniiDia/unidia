import type { CommandHistory } from '../core/Command';
import type { DiagramModel } from '../core/DiagramModel';

/**
 * 다이어그램 파일 저장·불러오기 (REQ-12, SRS 3.4).
 * 파일 형식 검사는 core(DiagramModel.load)가 하고, 여기서는 UI가 쓸 결과와 메시지만 만든다.
 */

export const DIAGRAM_FILE_NAME = 'diagram.unidia.json';
export const DIAGRAM_FILE_MIME = 'application/json';
/** 파일 선택 창에 보여줄 형식 */
export const DIAGRAM_FILE_ACCEPT = '.json,application/json';
/** 이보다 큰 파일은 읽지 않는다 (잘못 고른 큰 파일로 화면이 멈추지 않게) */
export const MAX_DIAGRAM_FILE_BYTES = 5 * 1024 * 1024;

export type LoadResult = { ok: true } | { ok: false; message: string };

/** 저장할 파일 내용. 코드와 GUI 편집 정보(노드 위치·크기, 엣지 경로)가 함께 들어간다. */
export function diagramFileContent(model: DiagramModel): string {
  return model.toJSON();
}

/**
 * 파일 내용을 모델에 불러온다 (core 사용 규칙: model.load(json) 후 history.clear()).
 * 형식이 틀리면 모델과 편집 기록은 그대로 두고 실패 메시지를 돌려준다.
 */
export function loadDiagramFile(model: DiagramModel, history: CommandHistory, json: string): LoadResult {
  try {
    model.load(json);
  } catch (error) {
    return { ok: false, message: loadErrorMessage(error) };
  }
  // 불러오기 전 편집을 Ctrl+Z로 되돌리면 불러온 내용과 섞이므로 기록을 비운다.
  history.clear();
  return { ok: true };
}

/** 파일 크기 검사. 문제가 없으면 null, 있으면 사용자에게 보여줄 메시지. */
export function checkDiagramFileSize(bytes: number): string | null {
  if (bytes === 0) return '빈 파일입니다.';
  if (bytes > MAX_DIAGRAM_FILE_BYTES) {
    return `파일이 너무 큽니다 (${Math.ceil(bytes / 1024 / 1024)}MB). UniDia 파일은 5MB 이하만 불러올 수 있습니다.`;
  }
  return null;
}

function loadErrorMessage(error: unknown): string {
  // JSON.parse 실패는 브라우저마다 영어 메시지가 달라서 한 문장으로 바꾼다.
  if (error instanceof SyntaxError) return '불러오지 못했습니다: JSON 형식이 아닌 파일입니다.';
  const detail = error instanceof Error ? error.message : String(error);
  return `불러오지 못했습니다: ${detail}`;
}
