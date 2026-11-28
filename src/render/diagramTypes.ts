export const diagramLabels = { class: '클래스', sequence: '시퀀스', flowchart: '흐름도', state: '상태', er: 'ER', pie: '원형 차트',
  gantt: '간트 차트', timeline: '타임라인', journey: '사용자 여정', gitGraph: 'Git 그래프', quadrantChart: '사분면 차트',
  'xychart-beta': 'XY 차트', mindmap: '마인드맵', kanban: '칸반', requirementDiagram: '요구사항',
  'sankey-beta': 'Sankey', 'radar-beta': '레이더 차트', C4Context: 'C4', 'block-beta': '블록' } as const;
export type DiagramType = keyof typeof diagramLabels;

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
  if (/^(flowchart|graph)(?=\s|$)/.test(source)) return 'flowchart';
  if (/^stateDiagram(?:-v2)?(?=\s|$)/.test(source)) return 'state';
  if (/^erDiagram(?=\s|$)/.test(source)) return 'er';
  if (/^pie(?=\s|$)/.test(source)) return 'pie';
  for (const type of ['gantt', 'timeline', 'journey', 'gitGraph', 'quadrantChart', 'xychart-beta', 'mindmap', 'kanban', 'requirementDiagram', 'sankey-beta', 'radar-beta', 'C4Context', 'block-beta'] as const) {
    if (source.split(/\s/, 1)[0] === type) return type;
  }
  return null;
}
