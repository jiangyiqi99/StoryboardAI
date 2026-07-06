import type {
  FirstFrameVideoRequest,
  FirstLastFrameVideoRequest,
  ImageToVideoRequest,
  ProviderJobRef,
  TextToVideoRequest
} from "@shared/types/ai";

export interface ThinModelProxyClient {
  submitTextToVideo(request: TextToVideoRequest): Promise<ProviderJobRef>;
  submitImageToVideo(request: ImageToVideoRequest): Promise<ProviderJobRef>;
  submitFirstFrameVideo(request: FirstFrameVideoRequest): Promise<ProviderJobRef>;
  submitFirstLastFrameVideo(
    request: FirstLastFrameVideoRequest
  ): Promise<ProviderJobRef>;
  getJobStatus(providerId: string, providerJobId: string): Promise<ProviderJobRef>;
  cancelJob(providerId: string, providerJobId: string): Promise<void>;
}

export class HttpThinModelProxyClient implements ThinModelProxyClient {
  constructor(private readonly baseUrl: string) {}

  async submitTextToVideo(_request: TextToVideoRequest): Promise<ProviderJobRef> {
    void this.baseUrl;
    throw new Error("Thin model proxy submit is not implemented in the scaffold.");
  }

  async submitImageToVideo(_request: ImageToVideoRequest): Promise<ProviderJobRef> {
    throw new Error("Thin model proxy submit is not implemented in the scaffold.");
  }

  async submitFirstFrameVideo(
    _request: FirstFrameVideoRequest
  ): Promise<ProviderJobRef> {
    throw new Error("Thin model proxy submit is not implemented in the scaffold.");
  }

  async submitFirstLastFrameVideo(
    _request: FirstLastFrameVideoRequest
  ): Promise<ProviderJobRef> {
    throw new Error("Thin model proxy submit is not implemented in the scaffold.");
  }

  async getJobStatus(
    _providerId: string,
    _providerJobId: string
  ): Promise<ProviderJobRef> {
    throw new Error("Thin model proxy status polling is not implemented.");
  }

  async cancelJob(_providerId: string, _providerJobId: string): Promise<void> {
    throw new Error("Thin model proxy cancellation is not implemented.");
  }
}
