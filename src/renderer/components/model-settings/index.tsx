import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  KeyRound,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X
} from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent
} from "react";
import type {
  AppConfig,
  GoogleVeoConfig,
  VolcengineSeedanceConfig
} from "@shared/types/app-config";
import { desktopApi } from "../../ipc/api";

type ProviderKind = "seedance" | "veo";

interface ProviderDefinition {
  id: ProviderKind;
  title: string;
  subtitle: string;
  providerId: string;
  modelHint: string;
}

interface SeedanceFormState {
  alias: string;
  apiKey: string;
  baseUrl: string;
  reqKey: string;
  timeoutMs: string;
  pollIntervalMs: string;
  pollTimeoutMs: string;
}

interface VeoFormState {
  alias: string;
  apiKey: string;
  projectId: string;
  location: string;
  textImageModel: string;
  extensionModel: string;
  defaultSampleCount: string;
  defaultAspectRatio: string;
  defaultResolution: string;
  defaultPersonGeneration: string;
  timeoutMs: string;
  pollIntervalMs: string;
  pollTimeoutMs: string;
}

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "seedance",
    title: "Seedance",
    subtitle: "火山方舟视频生成 API",
    providerId: "volcengine-seedance",
    modelHint: "文字生成、首帧、首尾帧"
  },
  {
    id: "veo",
    title: "Google Veo",
    subtitle: "Google Cloud Vertex AI Veo",
    providerId: "google-veo",
    modelHint: "文字生成、首帧、首尾帧"
  }
];

export const ModelSettingsPanel = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderKind | null>(null);
  const [message, setMessage] = useState("模型 Provider 设置会保存到本机全局配置。");
  const [isLoading, setIsLoading] = useState(true);
  const [deletingProvider, setDeletingProvider] = useState<ProviderKind | null>(null);

  useEffect(() => {
    let isMounted = true;

    desktopApi.config
      .get()
      .then((loadedConfig) => {
        if (!isMounted) {
          return;
        }

        setConfig(loadedConfig);
        setMessage("已加载本机模型设置。");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setMessage(getErrorMessage(error));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const addedProviders = providerDefinitions.filter((provider) =>
    isProviderAdded(provider.id, config)
  );

  const getNextProviderToAdd = () => {
    const unconfigured = providerDefinitions.find(
      (provider) => !isProviderAdded(provider.id, config)
    );
    return unconfigured?.id ?? "seedance";
  };

  const handleDeleteProvider = async (provider: ProviderKind) => {
    setDeletingProvider(provider);

    try {
      const updatedConfig = await desktopApi.config.save({
        config: {
          providers:
            provider === "seedance"
              ? {
                  volcengineSeedance: deletedSeedanceConfig()
                }
              : {
                  googleVeo: deletedVeoConfig()
                }
        }
      });

      setConfig(updatedConfig);
      setMessage(`已删除 ${getProviderTitle(provider)} 配置。`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setDeletingProvider(null);
    }
  };

  return (
    <section className="panel model-settings-panel" data-panel="model-settings">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">模型设置</h2>
          <p className="panel-subtitle">管理视频生成 Model Provider 和 API Key。</p>
        </div>
        <div className="panel-actions">
          <button
            className="primary-button compact"
            onClick={() => setActiveProvider(getNextProviderToAdd())}
            type="button"
          >
            <Plus size={16} />
            <span>添加</span>
          </button>
        </div>
      </div>

      <div className="provider-list">
        {addedProviders.length === 0 ? (
          <div className="provider-empty-state">
            <Settings size={28} />
            <h3>还没有 Model Provider</h3>
            <p>点击“添加”，选择 Seedance 或 Google Veo，并填写 Alias 与 API 信息。</p>
          </div>
        ) : null}

        {addedProviders.map((provider) => {
          const configured = isProviderConfigured(provider.id, config);
          return (
            <article className="provider-card" key={provider.id}>
              <div className="provider-card-icon">
                {provider.id === "seedance" ? <Cloud size={22} /> : <Settings size={22} />}
              </div>
              <div className="provider-card-body">
                <div className="provider-card-title-row">
                  <h3>{getProviderAlias(provider.id, config)}</h3>
                  <span
                    className={
                      configured
                        ? "provider-status is-configured"
                        : "provider-status"
                    }
                  >
                    {configured ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {configured ? "已配置" : "待配置"}
                  </span>
                </div>
                <p>{provider.title} · {provider.subtitle}</p>
                <dl>
                  <div>
                    <dt>Alias</dt>
                    <dd>{getProviderAlias(provider.id, config)}</dd>
                  </div>
                  <div>
                    <dt>Provider ID</dt>
                    <dd>{provider.providerId}</dd>
                  </div>
                  <div>
                    <dt>能力</dt>
                    <dd>{provider.modelHint}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>{getProviderModelLabel(provider.id, config)}</dd>
                  </div>
                </dl>
              </div>
              <div className="provider-card-actions">
                <button
                  className="ghost-button compact"
                  onClick={() => setActiveProvider(provider.id)}
                  type="button"
                >
                  <Pencil size={14} />
                  <span>{configured ? "编辑" : "配置"}</span>
                </button>
                <button
                  className="ghost-button compact danger"
                  disabled={deletingProvider === provider.id}
                  onClick={() => handleDeleteProvider(provider.id)}
                  type="button"
                >
                  <Trash2 size={14} />
                  <span>{deletingProvider === provider.id ? "删除中" : "删除"}</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <p className={isLoading ? "settings-message is-loading" : "settings-message"}>
        {isLoading ? "正在读取全局配置..." : message}
      </p>

      {activeProvider ? (
        <ProviderConfigDialog
          config={config}
          provider={activeProvider}
          onClose={() => setActiveProvider(null)}
          onSaved={(updatedConfig, savedProvider) => {
            setConfig(updatedConfig);
            setActiveProvider(null);
            setMessage(`已保存 ${getProviderTitle(savedProvider)} 设置。`);
          }}
        />
      ) : null}
    </section>
  );
};

interface ProviderConfigDialogProps {
  config: AppConfig | null;
  provider: ProviderKind;
  onClose(): void;
  onSaved(config: AppConfig, provider: ProviderKind): void;
}

const ProviderConfigDialog = ({
  config,
  provider,
  onClose,
  onSaved
}: ProviderConfigDialogProps) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(provider);
  const [seedanceForm, setSeedanceForm] = useState<SeedanceFormState>(() =>
    seedanceToForm(config?.providers.volcengineSeedance)
  );
  const [veoForm, setVeoForm] = useState<VeoFormState>(() =>
    veoToForm(config?.providers.googleVeo)
  );
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  const selectedDefinition = providerDefinitions.find(
    (definition) => definition.id === selectedProvider
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(undefined);

    try {
      const updatedConfig = await desktopApi.config.save({
        config: {
          providers:
            selectedProvider === "seedance"
              ? {
                  volcengineSeedance: seedanceFormToConfig(seedanceForm)
                }
              : {
                  googleVeo: veoFormToConfig(veoForm)
                }
        }
      });

      onSaved(updatedConfig, selectedProvider);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      aria-labelledby="provider-dialog-title"
      aria-modal="true"
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <form className="export-dialog provider-dialog" onSubmit={handleSubmit}>
        <header className="export-dialog-head">
          <div>
            <h2 id="provider-dialog-title">Model Provider 设置</h2>
            <p>{selectedDefinition?.subtitle ?? "添加或编辑模型服务商"}</p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            <X size={17} />
          </button>
        </header>

        <label className="export-field">
          <span>Provider</span>
          <select
            onChange={(event) =>
              setSelectedProvider(event.currentTarget.value as ProviderKind)
            }
            value={selectedProvider}
          >
            {providerDefinitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.title}
              </option>
            ))}
          </select>
        </label>

        {selectedProvider === "seedance" ? (
          <SeedanceFields form={seedanceForm} onChange={setSeedanceForm} />
        ) : (
          <VeoFields form={veoForm} onChange={setVeoForm} />
        )}

        {errorMessage ? <p className="settings-error">{errorMessage}</p> : null}

        <footer className="export-dialog-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            <KeyRound size={16} />
            <span>{isSaving ? "保存中" : "保存 Provider"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
};

interface SeedanceFieldsProps {
  form: SeedanceFormState;
  onChange(form: SeedanceFormState): void;
}

const SeedanceFields = ({ form, onChange }: SeedanceFieldsProps) => {
  const update = (key: keyof SeedanceFormState, value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="provider-form-grid">
      <ProviderTextField
        label="Alias"
        onChange={(value) => update("alias", value)}
        value={form.alias}
      />
      <ProviderTextField
        label="ARK API Key"
        onChange={(value) => update("apiKey", value)}
        placeholder="从火山方舟 API Key 页面获取"
        type="password"
        value={form.apiKey}
      />
      <ProviderTextField
        label="Model ID / Endpoint ID"
        onChange={(value) => update("reqKey", value)}
        placeholder="doubao-seedance-2-0-260128"
        value={form.reqKey}
      />
      <ProviderTextField
        label="Base URL"
        onChange={(value) => update("baseUrl", value)}
        placeholder="https://ark.cn-beijing.volces.com/api/v3"
        value={form.baseUrl}
      />
      <ProviderTextField
        label="请求超时 ms"
        onChange={(value) => update("timeoutMs", value)}
        type="number"
        value={form.timeoutMs}
      />
      <ProviderTextField
        label="轮询间隔 ms"
        onChange={(value) => update("pollIntervalMs", value)}
        type="number"
        value={form.pollIntervalMs}
      />
      <ProviderTextField
        label="轮询超时 ms"
        onChange={(value) => update("pollTimeoutMs", value)}
        type="number"
        value={form.pollTimeoutMs}
      />
    </div>
  );
};

interface VeoFieldsProps {
  form: VeoFormState;
  onChange(form: VeoFormState): void;
}

const VeoFields = ({ form, onChange }: VeoFieldsProps) => {
  const update = (key: keyof VeoFormState, value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="provider-form-grid">
      <ProviderTextField
        label="Alias"
        onChange={(value) => update("alias", value)}
        value={form.alias}
      />
      <ProviderTextField
        label="Google API Key"
        onChange={(value) => update("apiKey", value)}
        type="password"
        value={form.apiKey}
      />
      <ProviderTextField
        label="Cloud Project"
        onChange={(value) => update("projectId", value)}
        placeholder="your-gcp-project"
        value={form.projectId}
      />
      <ProviderTextField
        label="Location"
        onChange={(value) => update("location", value)}
        placeholder="global"
        value={form.location}
      />
      <ProviderTextField
        label="Text/Image Model"
        onChange={(value) => update("textImageModel", value)}
        placeholder="veo-3.0-generate-preview"
        value={form.textImageModel}
      />
      <ProviderTextField
        label="Extension Model"
        onChange={(value) => update("extensionModel", value)}
        placeholder="可选，后续视频续写使用"
        value={form.extensionModel}
      />
      <ProviderTextField
        label="Sample Count"
        onChange={(value) => update("defaultSampleCount", value)}
        type="number"
        value={form.defaultSampleCount}
      />
      <ProviderTextField
        label="Aspect Ratio"
        onChange={(value) => update("defaultAspectRatio", value)}
        placeholder="16:9"
        value={form.defaultAspectRatio}
      />
      <ProviderTextField
        label="Resolution"
        onChange={(value) => update("defaultResolution", value)}
        placeholder="例如 720p，可选"
        value={form.defaultResolution}
      />
      <ProviderTextField
        label="Person Generation"
        onChange={(value) => update("defaultPersonGeneration", value)}
        placeholder="可选"
        value={form.defaultPersonGeneration}
      />
      <ProviderTextField
        label="请求超时 ms"
        onChange={(value) => update("timeoutMs", value)}
        type="number"
        value={form.timeoutMs}
      />
      <ProviderTextField
        label="轮询间隔 ms"
        onChange={(value) => update("pollIntervalMs", value)}
        type="number"
        value={form.pollIntervalMs}
      />
      <ProviderTextField
        label="轮询超时 ms"
        onChange={(value) => update("pollTimeoutMs", value)}
        type="number"
        value={form.pollTimeoutMs}
      />
    </div>
  );
};

interface ProviderTextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: "text" | "password" | "number";
  onChange(value: string): void;
}

const ProviderTextField = ({
  label,
  value,
  placeholder,
  type = "text",
  onChange
}: ProviderTextFieldProps) => {
  return (
    <label className="export-field">
      <span>{label}</span>
      <input
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
};

const seedanceToForm = (
  config: VolcengineSeedanceConfig | undefined
): SeedanceFormState => ({
  alias: config?.alias ?? "",
  apiKey: config?.apiKey ?? "",
  baseUrl: config?.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3",
  reqKey: config?.reqKey ?? "doubao-seedance-2-0-260128",
  timeoutMs: stringFromNumber(config?.timeoutMs ?? 60_000),
  pollIntervalMs: stringFromNumber(config?.pollIntervalMs ?? 30_000),
  pollTimeoutMs: stringFromNumber(config?.pollTimeoutMs ?? 600_000)
});

const veoToForm = (config: GoogleVeoConfig | undefined): VeoFormState => ({
  alias: config?.alias ?? "",
  apiKey: config?.apiKey ?? "",
  projectId: config?.projectId ?? "",
  location: config?.location ?? "global",
  textImageModel: config?.textImageModel ?? "veo-3.0-generate-preview",
  extensionModel: config?.extensionModel ?? "",
  defaultSampleCount: stringFromNumber(config?.defaultSampleCount ?? 1),
  defaultAspectRatio: config?.defaultAspectRatio ?? "16:9",
  defaultResolution: config?.defaultResolution ?? "",
  defaultPersonGeneration: config?.defaultPersonGeneration ?? "",
  timeoutMs: stringFromNumber(config?.timeoutMs ?? 60_000),
  pollIntervalMs: stringFromNumber(config?.pollIntervalMs ?? 5_000),
  pollTimeoutMs: stringFromNumber(config?.pollTimeoutMs ?? 600_000)
});

const seedanceFormToConfig = (
  form: SeedanceFormState
): Partial<VolcengineSeedanceConfig> => ({
  enabled: true,
  alias: optionalString(form.alias),
  apiKey: optionalString(form.apiKey),
  baseUrl: optionalString(form.baseUrl),
  reqKey: optionalString(form.reqKey),
  timeoutMs: optionalNumber(form.timeoutMs),
  pollIntervalMs: optionalNumber(form.pollIntervalMs),
  pollTimeoutMs: optionalNumber(form.pollTimeoutMs)
});

const deletedSeedanceConfig = (): Partial<VolcengineSeedanceConfig> => ({
  enabled: false,
  alias: undefined,
  apiKey: undefined,
  baseUrl: undefined,
  accessKeyId: undefined,
  secretAccessKey: undefined,
  sessionToken: undefined,
  reqKey: undefined,
  apiHost: undefined,
  apiVersion: undefined,
  region: undefined,
  service: undefined,
  timeoutMs: undefined,
  pollIntervalMs: undefined,
  pollTimeoutMs: undefined
});

const veoFormToConfig = (form: VeoFormState): Partial<GoogleVeoConfig> => ({
  enabled: true,
  alias: optionalString(form.alias),
  apiKey: optionalString(form.apiKey),
  projectId: optionalString(form.projectId),
  location: optionalString(form.location),
  textImageModel: optionalString(form.textImageModel),
  extensionModel: optionalString(form.extensionModel),
  defaultSampleCount: optionalNumber(form.defaultSampleCount),
  defaultAspectRatio: optionalString(form.defaultAspectRatio),
  defaultResolution: optionalString(form.defaultResolution),
  defaultPersonGeneration: optionalString(form.defaultPersonGeneration),
  timeoutMs: optionalNumber(form.timeoutMs),
  pollIntervalMs: optionalNumber(form.pollIntervalMs),
  pollTimeoutMs: optionalNumber(form.pollTimeoutMs)
});

const deletedVeoConfig = (): Partial<GoogleVeoConfig> => ({
  enabled: false,
  alias: undefined,
  apiKey: undefined,
  projectId: undefined,
  location: undefined,
  textImageModel: undefined,
  extensionModel: undefined,
  outputGcsUri: undefined,
  defaultSampleCount: undefined,
  defaultAspectRatio: undefined,
  defaultResolution: undefined,
  defaultPersonGeneration: undefined,
  timeoutMs: undefined,
  pollIntervalMs: undefined,
  pollTimeoutMs: undefined
});

const isProviderConfigured = (
  provider: ProviderKind,
  config: AppConfig | null
): boolean => {
  if (!config) {
    return false;
  }

  if (provider === "seedance") {
    return Boolean(config.providers.volcengineSeedance.apiKey);
  }

  return Boolean(config.providers.googleVeo.apiKey && config.providers.googleVeo.projectId);
};

const isProviderAdded = (
  provider: ProviderKind,
  config: AppConfig | null
): boolean => {
  if (!config) {
    return false;
  }

  return provider === "seedance"
    ? Boolean(config.providers.volcengineSeedance.enabled)
    : Boolean(config.providers.googleVeo.enabled);
};

const getProviderAlias = (
  provider: ProviderKind,
  config: AppConfig | null
): string => {
  if (provider === "seedance") {
    return config?.providers.volcengineSeedance.alias ?? "Seedance";
  }

  return config?.providers.googleVeo.alias ?? "Google Veo";
};

const getProviderModelLabel = (
  provider: ProviderKind,
  config: AppConfig | null
): string => {
  if (provider === "seedance") {
    return config?.providers.volcengineSeedance.reqKey ?? "doubao-seedance-2-0-260128";
  }

  return config?.providers.googleVeo.textImageModel ?? "veo-3.0-generate-preview";
};

const getProviderTitle = (provider: ProviderKind): string => {
  return providerDefinitions.find((definition) => definition.id === provider)?.title ?? provider;
};

const optionalString = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const optionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const stringFromNumber = (value: number | undefined): string => {
  return value === undefined ? "" : String(value);
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "模型设置保存失败。";
};
