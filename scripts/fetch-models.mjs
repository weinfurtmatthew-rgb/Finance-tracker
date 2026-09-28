#!/usr/bin/env node
/**
 * Downloads the on-device AI models from Hugging Face into a folder that gets published with the site
 * (e.g. `node scripts/fetch-models.mjs dist/models`), and writes models/manifest.json with their sizes.
 * Used by CI; the app itself never contacts Hugging Face.
 */
import { mkdir, writeFile, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2] ?? 'dist/models';
const cache = process.env.MODEL_CACHE ?? '.models-cache';
const MODELS = {
  embed: { id: 'all-MiniLM-L6-v2', repo: 'Xenova/all-MiniLM-L6-v2', onnx: 'model_quantized' },
  llm: { id: 'Qwen2.5-0.5B-Instruct', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', onnx: 'model_q4f16' },
};
const CONFIG = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'preprocessor_config.json'];

async function list(repo) {
  const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`);
  if (!r.ok) throw new Error(`${repo}: ${r.status}`);
  return (await r.json()).filter((f) => f.type === 'file');
}

async function download(repo, path, dest) {
  if (existsSync(dest)) return (await stat(dest)).size;
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(`https://huggingface.co/${repo}/resolve/main/${path}`);
  if (!r.ok) throw new Error(`${repo}/${path}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

const manifest = { total: 0, models: {} };
for (const [key, m] of Object.entries(MODELS)) {
  const files = await list(m.repo);
  const wanted = files
    .map((f) => f.path)
    .filter((p) => CONFIG.includes(p) || p === `onnx/${m.onnx}.onnx` || p.startsWith(`onnx/${m.onnx}.onnx_data`));
  if (!wanted.includes(`onnx/${m.onnx}.onnx`)) throw new Error(`${m.repo} has no onnx/${m.onnx}.onnx`);
  let bytes = 0;
  for (const p of wanted) {
    const cached = join(cache, m.id, p);
    bytes += await download(m.repo, p, cached);
    const dest = join(out, m.id, p);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(cached, dest);
  }
  manifest.models[key] = { id: m.id, bytes };
  manifest.total += bytes;
  console.log(`${m.id}: ${wanted.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`total ${(manifest.total / 1e6).toFixed(1)} MB → ${out}`);
