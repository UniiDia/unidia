type NodeAnchor = { node: SVGGraphicsElement; point: DOMPoint };

// Bind each endpoint to the nearest box once, before applying any saved layout.
function bindEndpoint(nodes: SVGGraphicsElement[], screen: DOMPoint): NodeAnchor {
  let best = nodes[0], distance = Infinity;
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    const dx = Math.max(r.left - screen.x, 0, screen.x - r.right);
    const dy = Math.max(r.top - screen.y, 0, screen.y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < distance) { best = node; distance = d; }
  }
  return { node: best, point: screen.matrixTransform(best.getScreenCTM()!.inverse()) };
}

export function bindChartLinks(svg: SVGSVGElement): () => void {
  const nodes = [...svg.querySelectorAll<SVGGraphicsElement>('g.node, g.mindmap-node')];
  if (!nodes.length) return () => {};
  const links = svg.querySelectorAll<SVGGeometryElement>(
    '.edgePaths > path, g.link > path, g.block > path.flowchart-link, line[marker-end]',
  );
  const redraw = Array.from(links).flatMap((edge, index) => {
    const length = edge.getTotalLength(), matrix = edge.getScreenCTM();
    if (!length || !matrix) return [];
    const from = edge.getPointAtLength(0), to = edge.getPointAtLength(length);
    const start = bindEndpoint(nodes, from.matrixTransform(matrix));
    const end = bindEndpoint(nodes, to.matrixTransform(matrix));
    const original = edge.getAttribute('d') || '';
    const steps = Math.max(8, Math.min(80, Math.ceil(length / 8)));
    const route = Array.from({length: steps + 1}, (_, i) => edge.getPointAtLength(length * i / steps));
    const label = svg.querySelectorAll<SVGGraphicsElement>('g.edgeLabels > g.edgeLabel')[index];
    const originalLabel = label?.getAttribute('transform') ?? '';
    return [() => {
      const current = edge.getScreenCTM();
      if (!current) return;
      const local = current.inverse();
      const at = (anchor: NodeAnchor) => anchor.point.matrixTransform(anchor.node.getScreenCTM()!).matrixTransform(local);
      const a = at(start), b = at(end);
      const dx = a.x-from.x, dy = a.y-from.y, ex = b.x-to.x, ey = b.y-to.y;
      if (edge instanceof SVGLineElement) {
        edge.setAttribute('x1', String(a.x)); edge.setAttribute('y1', String(a.y));
        edge.setAttribute('x2', String(b.x)); edge.setAttribute('y2', String(b.y));
      } else if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(ex), Math.abs(ey)) < 0.001) {
        edge.setAttribute('d', original);
      } else {
        edge.setAttribute('d', route.map((p,i) => {
          const t = i / steps;
          // Preserve a dragged bend in the middle while keeping both ends attached.
          const weight = 1 - 0.7 * Math.sin(Math.PI*t);
          const w = edge.hasAttribute('data-link-bent') ? weight : 1;
          return `${i ? 'L':'M'}${p.x + w*((1-t)*dx+t*ex)},${p.y + w*((1-t)*dy+t*ey)}`;
        }).join(' '));
      }
      if (label && !edge.hasAttribute('data-link-bent')) {
        const parent = (label.parentElement as unknown as SVGGraphicsElement).getScreenCTM();
        if (parent) {
          const m = parent.inverse().multiply(current);
          const x=(dx+ex)/2, y=(dy+ey)/2;
          label.setAttribute('transform', `translate(${m.a*x+m.c*y} ${m.b*x+m.d*y}) ${originalLabel}`);
        }
      }
    }];
  });
  return () => redraw.forEach(update => update());
}
