import { WORKFLOW_ID, MAX_GARMENTS } from './comfy-workflow.mjs';
import { checkWorkflow, generateWorkflow, workflowTimeout } from './comfyui.mjs';
import { HttpError } from './errors.mjs';
import { generateImage, listModels } from './imageapi.mjs';

export async function listGenerationModels(env, fetchImpl, signal) {
  return [...new Set([...await listModels(env, fetchImpl, signal), WORKFLOW_ID])];
}

export async function preflightGeneration(model, pieces, env, fetchImpl, signal) {
  if (model !== WORKFLOW_ID) return;
  if (pieces.length > MAX_GARMENTS) throw new HttpError(400, 'WORKFLOW_PIECES', `此试穿工作流最多 ${MAX_GARMENTS} 件服装，请减少单品或切换图片模型`, 'pieces');
  const status = await checkWorkflow(env, fetchImpl, signal);
  if (!status.ready) throw new HttpError(503, 'WORKFLOW_UNAVAILABLE', status.message, 'model');
}

export function generateTryon(payload, env, fetchImpl, { timeoutMs = 120000, signal } = {}) {
  return payload.model === WORKFLOW_ID
    ? generateWorkflow(payload, env, fetchImpl, { timeoutMs: workflowTimeout(env), signal })
    : generateImage(payload, env, fetchImpl, { timeoutMs, signal });
}
