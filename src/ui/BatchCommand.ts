import type { Command } from '../core/Command';

/**
 * 여러 편집을 실행 취소 한 번에 되돌리도록 묶는다.
 * 실행은 순서대로, 되돌리기는 거꾸로 한다. (예: 메시지 순서 변경 = 코드 변경 + 간격 조정 지우기)
 */
export class BatchCommand implements Command {
  constructor(private commands: readonly Command[]) {}

  execute(): void {
    for (const command of this.commands) command.execute();
  }

  undo(): void {
    for (const command of [...this.commands].reverse()) command.undo();
  }
}
