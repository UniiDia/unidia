import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const fixtures = {
  class: readFileSync(new URL('../examples/render/class-30.mmd', import.meta.url), 'utf8'),
  sequence: readFileSync(new URL('../examples/render/sequence-30.mmd', import.meta.url), 'utf8'),
};
type DiagramType = keyof typeof fixtures;

async function setCode(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Mermaid 코드' }).fill(code);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('.canvas-pane > svg')).toBeVisible();
}

async function labelMetrics(page: Page, type: DiagramType) {
  return page.locator('.canvas-pane > svg').evaluate((svg, kind) => {
    const pairs = kind === 'class'
      ? [...svg.querySelectorAll('g.node')].flatMap(node => {
        const shape = node.querySelector('g.outer-path')!;
        return [...node.querySelectorAll('text')].map(text => ({ text, shape }));
      })
      : [...svg.querySelectorAll('text.actor')].map(text => ({
        text,
        shape: text.parentElement!.querySelector('rect.actor')!,
      }));
    return pairs.map(({ text, shape }) => {
      const box = shape.getBoundingClientRect();
      const label = text.getBoundingClientRect();
      const ctm = (text as SVGGraphicsElement).getScreenCTM()!;
      const fontPixels = parseFloat(getComputedStyle(text).fontSize) * Math.hypot(ctm.c, ctm.d);
      return {
        text: text.textContent,
        lines: text.querySelectorAll('tspan.text-outer-tspan').length,
        fontToShape: fontPixels / box.height,
        fontPixels,
        shapeHeight: box.height,
        overflow: Math.max(0, box.left - label.left, label.right - box.right,
          box.top - label.top, label.bottom - box.bottom),
      };
    });
  }, type);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
});

for (const type of ['class', 'sequence'] as const) {
  test(`${type}: 30개 노드 렌더링 시간 실측 (REQ-01, REQ-07) @performance`, async ({ page, browser }, testInfo) => {
    await setCode(page, fixtures[type]);
    const firstMs = Number(await page.locator('.status').getAttribute('data-render-ms'));
    const nodes = type === 'class' ? 'g.node' : 'rect.actor-top';
    await expect(page.locator(`.canvas-pane svg ${nodes}`)).toHaveCount(30);

    const samples: number[] = [];
    for (let index = 0; index < 20; index++) {
      // 주석만 바꾸지 않고 실제 객체 이름/메시지를 바꿔 재렌더 비용을 측정한다.
      const code = type === 'class'
        ? fixtures[type].replaceAll('Node01', `Root${String(index).padStart(2, '0')}`)
        : fixtures[type].replace('request 1', `changed request ${index}`);
      await setCode(page, code);
      const milliseconds = Number(await page.locator('.status').getAttribute('data-render-ms'));
      expect(milliseconds).toBeGreaterThanOrEqual(150); // debounce도 실측에 포함
      samples.push(milliseconds);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const summary = {
      type,
      browser: browser.version(),
      measuredAt: new Date().toISOString(),
      nodeCount: 30,
      edgeCount: 29,
      firstMs,
      samples,
      meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
      p95Ms: sorted[Math.ceil(samples.length * 0.95) - 1],
      maxMs: sorted[sorted.length - 1],
      within1000Ms: samples.filter(sample => sample <= 1000).length,
    };
    const report = JSON.stringify(summary, null, 2);
    writeFileSync(testInfo.outputPath('performance.json'), report);
    await testInfo.attach('performance', { body: report, contentType: 'application/json' });
    console.log(`PERFORMANCE ${JSON.stringify(summary)}`);
    await page.getByRole('combobox', { name: '다이어그램 배율' }).selectOption('0.25');
    await page.screenshot({ path: testInfo.outputPath('30-nodes.png') });
    expect(summary.within1000Ms / samples.length).toBeGreaterThanOrEqual(0.95);
  });

  test(`${type}: 25~400%에서 폰트 비율·줄바꿈·넘침 (REQ-06)`, async ({ page }, testInfo) => {
    await setCode(page, fixtures[type]);
    const baseline = await labelMetrics(page, type);
    expect(baseline.length).toBeGreaterThanOrEqual(30);
    const svgId = await page.locator('.canvas-pane > svg').getAttribute('id');
    const measurements = [];
    for (const zoom of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
      await page.getByRole('combobox', { name: '다이어그램 배율' }).selectOption(String(zoom));
      const labels = await labelMetrics(page, type);
      expect(labels.map(({ text, lines }) => ({ text, lines }))).toEqual(
        baseline.map(({ text, lines }) => ({ text, lines })),
      );
      const maxRatioChangePercent = Math.max(...labels.map((label, index) =>
        Math.abs(label.fontToShape / baseline[index].fontToShape - 1) * 100));
      const maxOverflowPx = Math.max(...labels.map(label => label.overflow));
      measurements.push({ zoom, labels: labels.length, maxRatioChangePercent, maxOverflowPx,
        sampleFontPixels: labels[0].fontPixels, sampleShapeHeight: labels[0].shapeHeight });
      expect(maxRatioChangePercent).toBeLessThanOrEqual(2);
      expect(maxOverflowPx).toBeLessThanOrEqual(0.1);
      expect(labels[0].fontPixels / baseline[0].fontPixels).toBeCloseTo(zoom, 2);
      await expect(page.locator('.canvas-pane > svg')).toHaveAttribute('id', svgId!);
    }
    const report = JSON.stringify({ type, measurements }, null, 2);
    writeFileSync(testInfo.outputPath('font-scaling.json'), report);
    await testInfo.attach('font-scaling', { body: report, contentType: 'application/json' });
    console.log(`FONT_SCALING ${JSON.stringify({ type, measurements })}`);
  });
}

test('문법 오류·미지원 입력 후 복구하고 배율을 유지한다', async ({ page }) => {
  await page.getByRole('combobox', { name: '다이어그램 배율' }).selectOption('2');
  for (const source of ['classDiagram\nA <|--', 'unknown TD\nA-->B', '']) {
    await page.getByRole('textbox', { name: 'Mermaid 코드' }).fill(source);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.canvas-pane > svg')).toHaveCount(0);
    await expect(page.locator('body > [id^="dunidia-render-"]')).toHaveCount(0);
  }
  await setCode(page, 'sequenceDiagram\nA->>B: recovered');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '다이어그램 배율' })).toHaveValue('2');
  const scale = await page.locator('.canvas-pane > svg').evaluate(svg =>
    svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width);
  expect(scale).toBeCloseTo(2, 2);
});

test('한글·여러 줄 라벨과 두 유형의 기본 객체를 생성한다', async ({ page }, testInfo) => {
  const codes = {
    class: `---
title: 수강 신청
---
classDiagram
class Student["학생 Student"] {
  +String 이름
  +수강신청()
}
class Course["강의 Course"] {
  +String 강의명
  +정원확인()
}
Student "1" --> "0..*" Course : 수강
`,
    sequence: `sequenceDiagram
participant Student as 학생<br/>Student
participant Server as 수강 서버
Student->>+Server: 수강 신청
alt 정원 있음
  Server-->>Student: 신청 완료
else 정원 초과
  Server-->>Student: 신청 실패
end
deactivate Server
Note over Student,Server: 결과 확인
`,
  };
  for (const type of ['class', 'sequence'] as const) {
    await setCode(page, codes[type]);
    await expect(page.locator('.canvas-pane svg')).toContainText('학생');
    await expect(page.locator('.canvas-pane foreignObject')).toHaveCount(0);
    for (const zoom of ['0.25', '1', '4']) {
      await page.getByRole('combobox', { name: '다이어그램 배율' }).selectOption(zoom);
      const labels = await labelMetrics(page, type);
      expect(labels.length).toBeGreaterThan(0);
      expect(Math.max(...labels.map(label => label.overflow))).toBeLessThanOrEqual(0.1);
    }
    await page.getByRole('combobox', { name: '다이어그램 배율' }).selectOption('1');
    await page.screenshot({ path: testInfo.outputPath(`${type}-korean.png`) });
  }
});

test('여러 RenderEngine 인스턴스의 SVG ID가 충돌하지 않는다', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const modulePath = '/src/render/RenderEngine.ts';
    const { RenderEngine } = await import(modulePath);
    const results = await Promise.all([
      new RenderEngine().render('classDiagram\nclass A'),
      new RenderEngine().render('sequenceDiagram\nA->>B: hi'),
    ]);
    return results.map(result => new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement.id);
  });
  expect(new Set(ids).size).toBe(2);
  expect(ids.every(Boolean)).toBe(true);
});

test('viewport 해제 시 원래 SVG 속성을 복구하고 배율을 제한한다', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/src/render/SvgViewport.ts';
    const { SvgViewport } = await import(modulePath);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    svg.setAttribute('style', 'max-width: 200px;');
    const original = svg.outerHTML;
    const viewport = new SvgViewport();
    viewport.attach(svg);
    viewport.setZoom(99);
    const maximum = Number(svg.getAttribute('width'));
    viewport.setZoom(0);
    const minimum = Number(svg.getAttribute('height'));
    viewport.detach();
    return { restored: svg.outerHTML === original, maximum, minimum };
  });
  expect(result).toEqual({ restored: true, maximum: 800, minimum: 25 });
});
