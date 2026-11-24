/** 화면의 편집 결과를 보존하되, 선택 핸들과 화면 배율을 제외한 SVG를 만든다. */
export function serializeDiagram(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.querySelectorAll('.unidia-overlay, .unidia-edge-hits').forEach(element => element.remove());
  copy.classList.remove('unidia-editable');
  // 래스터 내보내기가 출력 해상도를 정하므로 화면 배율의 CSS 크기가 우선하면 안 된다.
  for (const property of ['width', 'height', 'max-width']) copy.style.removeProperty(property);
  const { width, height } = svg.viewBox.baseVal;
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(copy);
}
