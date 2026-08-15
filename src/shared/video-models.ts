export interface VideoModelOption {
  id: string;
  label: string;
}

export const SEEDANCE_MODEL_OPTIONS = [
  {
    id: "doubao-seedance-2-0-260128",
    label: "Doubao Seedance 2.0"
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Doubao Seedance 2.0 Fast"
  }
] as const satisfies readonly VideoModelOption[];

export const VEO_MODEL_OPTIONS = [
  { id: "veo-3.1-generate-001", label: "Veo 3.1 Generate" },
  { id: "veo-3.1-fast-generate-001", label: "Veo 3.1 Fast Generate" },
  { id: "veo-3.0-generate-001", label: "Veo 3.0 Generate" },
  { id: "veo-3.0-fast-generate-001", label: "Veo 3.0 Fast Generate" },
  { id: "veo-2.0-generate-001", label: "Veo 2.0 Generate" }
] as const satisfies readonly VideoModelOption[];

export const DEFAULT_SEEDANCE_MODEL_ID = SEEDANCE_MODEL_OPTIONS[0].id;
export const DEFAULT_VEO_MODEL_ID = VEO_MODEL_OPTIONS[0].id;

export const normalizeSeedanceModelId = (modelId: string | undefined): string =>
  SEEDANCE_MODEL_OPTIONS.some((model) => model.id === modelId)
    ? modelId!
    : DEFAULT_SEEDANCE_MODEL_ID;

export const normalizeVeoModelId = (modelId: string | undefined): string =>
  VEO_MODEL_OPTIONS.some((model) => model.id === modelId)
    ? modelId!
    : DEFAULT_VEO_MODEL_ID;
