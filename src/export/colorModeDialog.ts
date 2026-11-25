/**
 * PNG/JPG 내보내기 색상 선택 (REQ-09).
 * - grayscale: 흑백 인쇄용 4색 팔레트(c1~c4)로 바꿔서 내보낸다.
 * - original: 화면(캔버스)에 보이는 색 그대로 내보낸다.
 *
 * UI 계층을 고치지 않고 내보내기 안에서 고를 수 있도록, 내보내기 시점에 작은 선택 창을 띄운다.
 * 나중에 UI에서 미리 고르게 하려면 ExportInput.colorMode를 넘기면 되고, 그때는 이 창이 뜨지 않는다.
 */
export type ColorMode = 'grayscale' | 'original';

/** 사용자가 선택 창에서 취소했을 때 */
export class ExportCancelledError extends Error {
  constructor() {
    super('내보내기를 취소했습니다.');
    this.name = 'ExportCancelledError';
  }
}

const OPTIONS: Array<{ mode: ColorMode; label: string; detail: string }> = [
  {
    mode: 'grayscale',
    label: '흑백 인쇄용 (4색 팔레트)',
    detail: '논문 등 흑백 인쇄에서도 색이 구분되도록 상자 색을 4가지 색으로 바꿉니다.',
  },
  {
    mode: 'original',
    label: '화면 색 그대로',
    detail: '캔버스에 보이는 색 그대로 내보냅니다. 컬러 출력용입니다.',
  },
];

/** 색상 선택 창을 띄운다. 취소(취소 버튼·Esc·바깥 클릭)하면 null. */
export function askColorMode(format: string): Promise<ColorMode | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'unidia-color-mode-title');
    dialog.style.cssText =
      'border:1px solid #ccc;border-radius:8px;padding:16px 20px;max-width:360px;font:14px/1.5 system-ui,sans-serif;';

    const title = document.createElement('h2');
    title.id = 'unidia-color-mode-title';
    title.textContent = `${format.toUpperCase()} 내보내기 색상`;
    title.style.cssText = 'margin:0 0 12px;font-size:16px;';
    dialog.appendChild(title);

    let result: ColorMode | null = null;
    const finish = (mode: ColorMode | null) => {
      result = mode;
      dialog.close();
    };

    OPTIONS.forEach((option, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mode = option.mode;
      button.style.cssText =
        'display:block;width:100%;text-align:left;margin:0 0 8px;padding:8px 12px;cursor:pointer;';
      const label = document.createElement('strong');
      label.textContent = option.label;
      const detail = document.createElement('div');
      detail.textContent = option.detail;
      detail.style.cssText = 'font-size:12px;color:#555;';
      button.append(label, detail);
      button.addEventListener('click', () => finish(option.mode));
      if (i === 0) button.autofocus = true; // 논문용이 기본 목적이므로 흑백 인쇄용에 초점
      dialog.appendChild(button);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '취소';
    cancel.style.cssText = 'margin-top:4px;';
    cancel.addEventListener('click', () => finish(null));
    dialog.appendChild(cancel);

    // 대화상자 바깥(배경)을 누르면 취소
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(null);
    });
    // Esc로 닫혀도 close 이벤트가 오므로 여기서 한 번에 정리한다.
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
