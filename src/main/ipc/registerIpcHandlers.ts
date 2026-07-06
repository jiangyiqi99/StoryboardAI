import type { AppServices } from "../services/appServices";
import { registerAiHandlers } from "./aiHandlers";
import { registerMediaHandlers } from "./mediaHandlers";
import { registerProjectHandlers } from "./projectHandlers";

export const registerIpcHandlers = (services: AppServices): void => {
  registerProjectHandlers(services);
  registerMediaHandlers(services);
  registerAiHandlers(services);
};
