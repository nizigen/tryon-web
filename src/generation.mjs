import { WORKFLOW_ID, MAX_GARMENTS } from './comfy-workflow.mjs';
import { checkWorkflow, generateWorkflow, workflowTimeout } from './comfyui.mjs';
import { HttpError } from './errors.mjs';
import { generateImage, listModels } from './imageapi.mjs';
import { generateIdm, IDM_ID, idmTimeout, preflightIdm } from './idm.mjs';

export async function listGenerationModels(env, fetchImpl, signal) {
  return [...new Set([...await listModels(env, fetchImpl, signal), WORKFLOW_ID, ...(env.IDM_BASE_URL ? [IDM_ID] : [])])];
}

export async function preflightGeneration(model, pieces, env, fetchImpl, signal) {
  if (model === IDM_ID) return preflightIdm(pieces, env, fetchImpl, signal);
  if (model !== WORKFLOW_ID) return;
  if (pieces.length > MAX_GARMENTS) throw new HttpError(400, 'WORKFLOW_PIECES', `此试穿工作流最多 ${MAX_GARMENTS} 件服装，请减少单品或切换图片模型`, 'pieces');
  const status = await checkWorkflow(env, fetchImpl, signal);
  if (!status.ready) throw new HttpError(503, 'WORKFLOW_UNAVAILABLE', status.message, 'model');
}

export function supportsPhotographyMode(model, photographyMode) {
  return photographyMode !== 'studio' || ![IDM_ID, WORKFLOW_ID].includes(model);
}

export function generateTryon(payload, env, fetchImpl, { timeoutMs = 120000, signal } = {}) {
  if (payload.model === IDM_ID) return generateIdm(payload, env, fetchImpl, { timeoutMs: idmTimeout(env), signal });
  return payload.model === WORKFLOW_ID
    ? generateWorkflow(payload, env, fetchImpl, { timeoutMs: workflowTimeout(env), signal })
    : generateImage(payload, env, fetchImpl, { timeoutMs, signal });
}
