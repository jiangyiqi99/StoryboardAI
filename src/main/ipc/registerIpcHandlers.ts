import type { AppServices } from "../services/appServices";
import { registerAiHandlers } from "./aiHandlers";
import { registerAppConfigHandlers } from "./appConfigHandlers";
import { registerMediaHandlers } from "./mediaHandlers";
import { registerProjectHandlers } from "./projectHandlers";
import { registerStoryScriptHandlers } from "./storyScriptHandlers";

export const registerIpcHandlers = (services: AppServices): void => {
  registerAppConfigHandlers(services);
  registerProjectHandlers(services);
  registerStoryScriptHandlers();
  registerMediaHandlers(services);
  registerAiHandlers(services);
};
