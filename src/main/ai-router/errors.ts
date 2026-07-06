import type { AiRoutingErrorInfo } from "@shared/ai-routing";

export class AiRoutingError extends Error {
  constructor(readonly info: AiRoutingErrorInfo) {
    super(info.message);
    this.name = "AiRoutingError";
  }
}

export const toRoutingErrorInfo = (error: unknown): AiRoutingErrorInfo => {
  if (error instanceof AiRoutingError) {
    return error.info;
  }

  if (error instanceof Error) {
    return {
      code: "UNKNOWN",
      message: error.message,
      retryable: false
    };
  }

  return {
    code: "UNKNOWN",
    message: "Unknown AI routing error",
    retryable: false
  };
};
