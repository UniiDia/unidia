import { bindChartLinks } from './chartLinks';
import type { NodeLayout } from '../core/DiagramModel';
import type { DiagramType } from '../render/diagramTypes';
import type { OverlayCallbacks } from './OverlayLayer';

type ChartType = Exclude<DiagramType, 'class' | 'sequence'>;
type Part = SVGGraphicsElement;
// Each row describes one draggable object and its separately drawn labels.
const parts: Record<ChartType, string[][]> = {
  'xychart-beta': [['g[class^="bar-plot-"] rect'], ['g[class^="line-plot-"] path']],
  mindmap: [['.mindmap-node'], ['.edge']],
  kanban: [['g.node']],
  requirementDiagram: [['g.node'], ['.edgePaths > path']],
  'sankey-beta': [['g.node', '.node-labels text'], ['g.link path']],
  'radar-beta': [['text.radarAxisLabel']],
  C4Context: [['g.node']],
  'block-beta': [['g.node'], ['path.edge-thickness-normal']],
  flowchart: [['g.node'], ['.edgePaths > path', 'g.edgeLabels > g.edgeLabel']],
  state: [['g.node'], ['.edgePaths > path', 'g.edgeLabels > g.edgeLabel']],
  er: [['g.node'], ['.edgePaths > path', 'g.edgeLabels > g.edgeLabel']],
  pie: [['path.pieCircle', 'text.slice'], ['g.legend']],
  gantt: [['rect.task', 'text[class^="taskText"]']],
  timeline: [['g.taskWrapper'], ['g.eventWrapper'], ['g.lineWrapper']],
  journey: [['g:has(> rect.task)'], ['g:has(> rect.journey-section)']],
  gitGraph: [['.commit-bullets > circle.commit:not(.commit-merge)'], ['.commit-labels > g'],
    ['.commit-arrows > path'], ['line.branch'], ['rect.branchLabelBkg', 'g.branchLabel']],
  quadrantChart: [['g.data-point'], ['g.quadrant']],
};

export class ChartDragOverlay {
  private events?: AbortController;

  constructor(private callbacks: OverlayCallbacks) {}

  detach(): void { this.events?.abort(); }

  attach(svg: SVGSVGElement, type: ChartType, layouts: Record<string, NodeLayout>): void {
    this.detach();
    const events = this.events = new AbortController();
    svg.classList.add('unidia-editable');
    const updateLinks = bindChartLinks(svg);
    const bars = [...svg.querySelectorAll<SVGRectElement>('g[class^="bar-plot-"] rect')];
    const lines = svg.querySelectorAll<SVGPathElement>('g[class^="line-plot-"] path');
    const linkedLine = type === 'xychart-beta' && lines.length === 1 &&
      svg.querySelectorAll('g[class^="bar-plot-"]').length === 1 ? lines[0] : undefined;
    const updateBarLine = () => {
      const matrix = linkedLine?.getCTM();
      if (!linkedLine || !matrix) return;
      const inverse = matrix.inverse();
      const points = bars.map((bar, index) => {
        const box = bar.getBBox();
        const top = new DOMPoint(box.x + box.width / 2, box.y)
          .matrixTransform(inverse.multiply(bar.getCTM()!));
        return `${index ? 'L' : 'M'}${top.x},${top.y}`;
      });
      linkedLine.setAttribute('d', points.join(' '));
      linkedLine.style.pointerEvents = 'none';
    };
    updateBarLine();
    const restore: (() => void)[] = [];
    for (const selectors of parts[type]) {
      const [shapes, ...labels] = selectors.map(selector => [...svg.querySelectorAll<Part>(selector)]);
      shapes.forEach((shape, index) => {
        if (shape === linkedLine) return;
        const members = [shape, ...labels.flatMap(list => list[index] ? [list[index]] : [])];
        if (type === 'gitGraph' && shape.matches('circle.commit')) {
          const ring = shape.nextElementSibling;
          if (ring?.matches('circle.commit-merge')) members.push(ring as Part);
        }
        const name = members.map(el => el.textContent?.trim()).filter(Boolean).join('/');
        const key = `chart:${type}:${selectors[0]}:${index}:${name}`;
        const prev = layouts[key];
        const base = members.map(el => el.getAttribute('transform') || '');
        // Store deltas in root SVG units, even when labels have different parents.
        const box = shape instanceof SVGGElement && shape.querySelector('text, foreignObject') && members.length === 1
          ? shape.getBBox() : undefined;
        const transform = (offset: NodeLayout) => members.forEach((el, i) => {
          const parent = (el.parentElement as unknown as Part).getCTM();
          const root = svg.getCTM();
          if (!parent || !root) return;
          const m = parent.inverse().multiply(root);
          const scale = box?.width && offset.width ? offset.width / box.width : 1;
          const resize = box && scale !== 1
            ? `translate(${box.x} ${box.y}) scale(${scale}) translate(${-box.x} ${-box.y})` : '';
          el.setAttribute('transform', `translate(${m.a*offset.x + m.c*offset.y} ${m.b*offset.x + m.d*offset.y}) ${base[i]} ${resize}`);
        });
        const paint = (offset: NodeLayout) => {
          transform(offset);
          if (shape instanceof SVGPathElement) shape.toggleAttribute('data-link-bent', !!(offset.x || offset.y));
          updateLinks();
          updateBarLine();
        };
        if (prev) restore.push(() => paint(prev));
        for (const el of members) {
          el.dataset.chartPart = key;
          el.addEventListener('pointerdown', e => {
            if (!e.isPrimary || e.button !== 0) return;
            const screen = svg.getScreenCTM();
            if (!screen) return;
            e.preventDefault();
            const inverse = screen.inverse();
            const start = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
            const gesture = new AbortController();
            const cancel = () => { gesture.abort(); paint(prev ?? { x: 0, y: 0 }); };
            events.signal.addEventListener('abort', cancel, { once: true, signal: gesture.signal });
            const resizing = e.target instanceof Element && e.target.hasAttribute('data-chart-resize');
            if (box && box.width > 0 && box.height > 0 && !resizing) {
              svg.querySelector('[data-chart-resize]')?.remove();
              const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              handle.setAttribute('class', 'unidia-overlay');
              handle.setAttribute('data-chart-resize', '');
              handle.setAttribute('x', String(box.x + box.width - 5));
              handle.setAttribute('y', String(box.y + box.height - 5));
              handle.setAttribute('width', '10');
              handle.setAttribute('height', '10');
              handle.setAttribute('fill', '#1a73e8');
              handle.style.cursor = 'nwse-resize';
              shape.append(handle);
            }
            const startBox = shape.getBoundingClientRect();
            el.setPointerCapture(e.pointerId);
            const offset = (p: PointerEvent) => {
              if (resizing && box) {
                const dx = p.clientX - e.clientX, dy = p.clientY - e.clientY;
                const w = startBox.width, h = startBox.height;
                const ratio = Math.max(0.2, ((prev?.width ?? box.width) / box.width) * (1 + (dx*w + dy*h)/(w*w+h*h)));
                return { x: prev?.x ?? 0, y: prev?.y ?? 0, width: box.width*ratio, height: box.height*ratio };
              }
              const now = new DOMPoint(p.clientX, p.clientY).matrixTransform(inverse);
              return { ...prev, x: (prev?.x ?? 0) + now.x - start.x, y: (prev?.y ?? 0) + now.y - start.y };
            };
            const opts = { signal: gesture.signal };
            el.addEventListener('pointermove', p => { if (p.pointerId === e.pointerId) paint(offset(p)); }, opts);
            el.addEventListener('lostpointercapture', cancel, opts);
            el.addEventListener('pointercancel', cancel, opts);
            el.addEventListener('pointerup', p => {
              if (p.pointerId !== e.pointerId) return;
              gesture.abort();
              const next = offset(p);
              if (Math.hypot(p.clientX-e.clientX, p.clientY-e.clientY) < 2) { paint(prev ?? {x:0,y:0}); return; }
              this.callbacks.onLayoutCommit(key, next, prev);
            }, opts);
          }, { signal: events.signal });
        }
      });
    }
    restore.forEach(apply => apply());
    // After a drop or reload, keep both the original page and moved content scrollable.
    if (restore.length) {
      const box = svg.getBBox(), view = svg.viewBox.baseVal;
      const x = Math.min(view.x, box.x - 16), y = Math.min(view.y, box.y - 16);
      const right = Math.max(view.x + view.width, box.x + box.width + 16);
      const bottom = Math.max(view.y + view.height, box.y + box.height + 16);
      svg.setAttribute('viewBox', [x, y, right-x, bottom-y].join(' '));
    }
  }
}
