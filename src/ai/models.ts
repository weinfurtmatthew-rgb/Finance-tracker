/** The on-device models, served from this site under /models/ (see scripts/fetch-models.mjs). */
export const MODELS = {
  embed: { id: 'all-MiniLM-L6-v2', repo: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', onnx: 'model_quantized' },
  llm: { id: 'Qwen2.5-0.5B-Instruct', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4f16', onnx: 'model_q4f16' },
} as const;

export interface ModelManifest {
  total: number;
  models: Record<keyof typeof MODELS, { id: string; bytes: number }>;
}
