import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const code = 'classDiagram\nclass A {\n+String name\n}\nA --> B';
const node = '[data-unidia-node="A"]';

async function ready(page: Page, source = code) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Mermaid 코드' }).fill(source);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
}

async function position(page: Page) {
  return page.locator(node).evaluate(element => {
    const matrix = (element as SVGGElement).transform.baseVal.consolidate()!.matrix;
    return { x: matrix.e, y: matrix.f };
  });
}

async function drag(page: Page, selector: string, dx: number, dy: number) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

for (const zoom of [0.25, 1, 2, 4]) {
  test(`${zoom * 100}%에서 오버레이 이동·Undo·Redo 후 좌표와 배율 유지`, async ({ page }) => {
    await ready(page);
    await page.getByRole('combobox').selectOption(String(zoom));
    const before = await position(page);
    const svgId = await page.locator('.canvas-pane > svg').getAttribute('id');
    await drag(page, node, 40, 24);
    const moved = await position(page);
    expect(moved.x - before.x).toBeCloseTo(40 / zoom, 1);
    expect(moved.y - before.y).toBeCloseTo(24 / zoom, 1);
    const actualZoom = await page.locator('.canvas-pane > svg').evaluate(svg =>
      svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width);
    expect(actualZoom).toBeCloseTo(zoom, 3);

    await page.getByRole('button', { name: '실행 취소', exact: false }).click();
    expect(await position(page)).toEqual(before);
    await page.getByRole('button', { name: '다시 실행', exact: false }).click();
    expect(await position(page)).toEqual(moved);
    await expect(page.locator('.canvas-pane > svg')).toHaveAttribute('id', svgId!);

    await page.getByRole('textbox').fill(code + '\nclass C');
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
    expect(await position(page)).toEqual(moved);
    await expect(page.locator('[data-unidia-node]')).toHaveCount(3);
  });
}

test('리사이즈 후 배율 유지 및 내보내기 SVG의 편집 결과·선택 도구 분리', async ({ page }) => {
  await ready(page);
  await page.getByRole('combobox').selectOption('2');
  await page.locator(node).click();
  const widthBefore = await page.locator(`${node} .label-container`).evaluate(el => el.getBoundingClientRect().width);
  await drag(page, '[data-unidia-handle="resize"]', 80, 50);
  const widthAfter = await page.locator(`${node} .label-container`).evaluate(el => el.getBoundingClientRect().width);
  expect(widthAfter - widthBefore).toBeCloseTo(80, 1);
  const snapshot = await page.evaluate(async () => {
    const modulePath = '/src/render/serializeDiagram.ts';
    const { serializeDiagram } = await import(modulePath);
    const svg = document.querySelector<SVGSVGElement>('.canvas-pane > svg')!;
    const before = svg.outerHTML;
    const copy = new DOMParser().parseFromString(serializeDiagram(svg), 'image/svg+xml');
    const root = copy.documentElement as unknown as SVGSVGElement;
    return {
      unchanged: before === svg.outerHTML,
      zoom: svg.getBoundingClientRect().width / svg.viewBox.baseVal.width,
      width: Number(root.getAttribute('width')),
      viewBoxWidth: svg.viewBox.baseVal.width,
      cssWidth: root.style.width,
      controls: copy.querySelectorAll('.unidia-overlay, .unidia-edge-hits').length,
      transform: copy.querySelector('[data-unidia-node="A"] .label-container')!.getAttribute('transform'),
      displayedTransform: svg.querySelector('[data-unidia-node="A"] .label-container')!.getAttribute('transform'),
    };
  });
  expect(snapshot).toMatchObject({ unchanged: true, zoom: 2, cssWidth: '', controls: 0 });
  expect(snapshot.width).toBe(snapshot.viewBoxWidth);
  expect(snapshot.transform).toBe(snapshot.displayedTransform);
});

test('입력 직후 코드 내보내기에 최신 입력을 포함한다', async ({ page }) => {
  await ready(page);
  const latest = 'sequenceDiagram\n학생->>서버: 마지막 입력';
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(source => {
    const textarea = document.querySelector('textarea')!;
    textarea.value = source;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-action="export-mermaid"]')!.click();
  }, latest);
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toBe(latest);
  await expect(page.getByRole('button', { name: '실행 취소', exact: false })).toBeEnabled();
});

test('빠른 유형 전환·오류 복구 후 현재 클래스만 편집한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.getByRole('textbox').fill('sequenceDiagram\nA->>B: temporary');
  await page.getByRole('textbox').fill('classDiagram\nclass Final');
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('[data-unidia-node="Final"]')).toBeVisible();
  await expect(page.locator('[data-unidia-node="A"]')).toHaveCount(0);
  await page.getByRole('textbox').fill('classDiagram\nA <|--');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox').fill(code);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'success');
  await drag(page, node, 30, 20);
  await expect(page.locator('.unidia-overlay')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('PR #3 PNG/JPG 변환과 렌더·오버레이 연결 @export-compatibility', async ({ page }, testInfo) => {
  // 검증할 PR의 정확한 소스 파일을 지정한다. 팀원의 변경을 이 PR에 복사하지 않는다.
  const sourcePath = process.env.UNIDIA_EXPORT_SOURCE;
  test.skip(!sourcePath, 'UNIDIA_EXPORT_SOURCE에 검증할 ExportStrategy.ts 경로를 지정');
  const compiled = ts.transpileModule(readFileSync(sourcePath!, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  await page.route('**/__qa/export-strategy.js', route => route.fulfill({
    contentType: 'application/javascript', body: compiled,
  }));
  await ready(page, 'classDiagram\nclass A["학생"] {\n+String 이름\n}\nA --> B');
  await drag(page, node, 60, 40);
  const records = [];
  for (const zoom of ['0.25', '1', '4']) {
    await page.getByRole('combobox').selectOption(zoom);
    const results = await page.evaluate(async () => {
      const snapshotModule = '/src/render/serializeDiagram.ts';
      const exportModule = '/__qa/export-strategy.js';
      const { serializeDiagram } = await import(snapshotModule);
      const { exportStrategies } = await import(exportModule);
      const svg = serializeDiagram(document.querySelector<SVGSVGElement>('.canvas-pane > svg')!);
      const images = [];
      for (const id of ['png', 'jpg']) {
        const blob = await exportStrategies.find((strategy: { id: string }) => strategy.id === id).export({ svg, code: '' });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 220) ink++;
        }
        const data = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(blob);
        });
        images.push({ id, mime: blob.type, width: bitmap.width, height: bitmap.height, ink, data });
        bitmap.close();
      }
      return images;
    });
    for (const result of results) {
      expect(result.width).toBeGreaterThanOrEqual(2000);
      expect(result.ink).toBeGreaterThan(1000);
      expect(result.mime).toBe(result.id === 'png' ? 'image/png' : 'image/jpeg');
      if (zoom === '4') writeFileSync(testInfo.outputPath(`edited.${result.id}`), Buffer.from(result.data, 'base64'));
      const { data: _data, ...metrics } = result;
      records.push({ zoom: Number(zoom), ...metrics });
    }
  }
  for (const id of ['png', 'jpg']) {
    const matching = records.filter(record => record.id === id);
    expect(new Set(matching.map(record => `${record.width}x${record.height}:${record.ink}`)).size).toBe(1);
  }
  writeFileSync(testInfo.outputPath('export-compatibility.json'), JSON.stringify(records, null, 2));
});
