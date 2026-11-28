/** 지원하는 다이어그램 유형 (REQ-07: 클래스, 시퀀스 2종). */
export type DiagramType = 'class' | 'sequence';

/**
 * Mermaid 코드의 첫 유효 줄로 다이어그램 유형을 판별한다.
 * YAML frontmatter, 주석, 여러 줄 init 지시문은 건너뛴다.
 * 문법 검증은 RenderEngine 안의 Mermaid가 담당한다.
 */
export function detectDiagramType(code: string): DiagramType | null {
  let source = code.replace(/\r\n?/g, '\n').trimStart();
  if (/^---\s*\n/.test(source)) {
    const closing = /^---\s*$/m.exec(source.slice(source.indexOf('\n') + 1));
    if (!closing) return null;
    source = source.slice(source.indexOf('\n') + 1 + closing.index + closing[0].length);
  }

  while ((source = source.trimStart()).startsWith('%%')) {
    if (source.startsWith('%%{')) {
      const end = source.indexOf('}%%');
      if (end < 0) return null;
      source = source.slice(end + 3);
    } else {
      const end = source.indexOf('\n');
      if (end < 0) return null;
      source = source.slice(end + 1);
    }
  }

  if (/^classDiagram(?:-v2)?(?=\s|;|$)/.test(source)) return 'class';
  if (/^sequenceDiagram(?=\s|;|$)/.test(source)) return 'sequence';
  return null;
}
