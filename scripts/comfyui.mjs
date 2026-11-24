import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { checkWorkflow } from '../src/comfyui.mjs';
import { workflowGraph, WORKFLOW_ID } from '../src/comfy-workflow.mjs';

const { values } = parseArgs({ options: { check: { type: 'boolean' }, export: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.check && !values.export) {
  console.log('node --env-file-if-exists=.env scripts/comfyui.mjs --check\nnode --env-file-if-exists=.env scripts/comfyui.mjs --export <new-file.json>\n检查不上传、不出图；导出 API 图使用示例输入文件名，不覆盖已有文件。');
} else {
  if (values.export) {
    const prompt = workflowGraph({ images: ['person.png', 'garment-1.png'], env: process.env });
    await writeFile(values.export, JSON.stringify({ prompt }, null, 2) + '\n', { flag: 'wx' });
    console.log(`已导出 ${WORKFLOW_ID} API 图`);
  }
  if (values.check) {
    const status = await checkWorkflow(process.env);
    console.log(JSON.stringify({ workflow: WORKFLOW_ID, ...status }, null, 2));
    if (!status.ready) process.exitCode = 1;
  }
}
