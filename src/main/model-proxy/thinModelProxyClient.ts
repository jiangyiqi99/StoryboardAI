import type {
  CancelGenerationJobRequest,
  GenerateVideoRequest,
  GenerateVideoResponse,
  GetGenerationJobStatusRequest
} from "@shared/ai-routing";

export interface ThinModelProxyClient {
  generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResponse>;
  getJobStatus(
    request: GetGenerationJobStatusRequest
  ): Promise<GenerateVideoResponse>;
  cancelJob(request: CancelGenerationJobRequest): Promise<GenerateVideoResponse>;
}

export class HttpThinModelProxyClient implements ThinModelProxyClient {
  constructor(private readonly baseUrl: string) {}

  async generateVideo(_request: GenerateVideoRequest): Promise<GenerateVideoResponse> {
    void this.baseUrl;
    throw new Error("Thin Model Proxy video generation is not implemented.");
  }

  async getJobStatus(
    _request: GetGenerationJobStatusRequest
  ): Promise<GenerateVideoResponse> {
    throw new Error("Thin Model Proxy job status polling is not implemented.");
  }

  async cancelJob(
    _request: CancelGenerationJobRequest
  ): Promise<GenerateVideoResponse> {
    throw new Error("Thin Model Proxy job cancellation is not implemented.");
  }
}
