import type { EditCommand, EditCommandExecutor } from "@shared/types/editing";

export class EditCommandBus {
  constructor(private readonly executor: EditCommandExecutor) {}

  async dispatch(command: EditCommand): Promise<void> {
    await this.executor.execute(command);
  }

  async undo(command: EditCommand): Promise<void> {
    await this.executor.undo(command);
  }
}
