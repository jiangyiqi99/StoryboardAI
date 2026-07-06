import type { EditCommand, EditCommandExecutor } from "@shared/types/editing";
import type { Project } from "@shared/types/project";

export class TimelineCommandExecutor implements EditCommandExecutor {
  constructor(private readonly getProject: () => Project) {}

  async execute(command: EditCommand): Promise<void> {
    void this.getProject;

    switch (command.type) {
      case "ADD_CLIP":
      case "REMOVE_CLIP":
      case "SPLIT_CLIP":
      case "TRIM_CLIP":
      case "MOVE_CLIP":
      case "REPLACE_RANGE":
        // TODO: apply non-destructive timeline mutation and append to edit history.
        throw new Error(`${command.type} is not implemented in the scaffold.`);
      default:
        command satisfies never;
    }
  }

  async undo(command: EditCommand): Promise<void> {
    // TODO: reverse command mutation using editHistory.future.
    throw new Error(`Undo for ${command.type} is not implemented in the scaffold.`);
  }
}
