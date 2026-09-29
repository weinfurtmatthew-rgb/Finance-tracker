/** The on-device model, served from this site under /models/ (see scripts/fetch-models.mjs). */
export const MODELS = {
  embed: { id: 'all-MiniLM-L6-v2', repo: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', onnx: 'model_quantized' },
} as const;

/** A language model (Qwen2.5-0.5B) used to be optional; its files are deleted from phones that have them. */
export const REMOVED_LLM_ID = 'Qwen2.5-0.5B-Instruct';

export interface ModelManifest {
  total: number;
  models: Record<keyof typeof MODELS, { id: string; bytes: number }>;
}
