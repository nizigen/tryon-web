import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { api } from '../../public/lib/api.js';

const EMPTY = { busy: false, batch: false, stage: '', index: 0, shots: [], original: null, background: null };
const UNCERTAIN = '网络中断，结果尚未确认，可稍后在“试穿记录”查看。';
export const STAGES = { queued: '排队中，马上轮到你', generating: '正在生成，请稍候', finalizing: '正在收尾，结果马上出来' };

function delay(signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 250);
    function cancel() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function settleOrder(body, signal, onStage) {
  let submitted;
  try {
    signal.throwIfAborted();
    submitted = await api('/api/orders', { method: 'POST', body, signal });
  } catch (failure) {
    signal.throwIfAborted();
    return failure.status && failure.status < 500 ? { status: 'failed', errorMessage: failure.message } : { status: 'unknown', errorMessage: '未收到建单确认，请到“试穿记录”查看。' };
  }
  const orderId = submitted.order?.id ?? submitted.orderId;
  try {
    while (!signal.aborted) {
      const job = await api(`/api/jobs/${encodeURIComponent(submitted.jobId)}`, { signal });
      signal.throwIfAborted();
      if (job.status === 'success' || job.status === 'failed') {
        const result = await api(`/api/orders/${encodeURIComponent(orderId)}`, { signal });
        return result.order;
      }
      onStage(job.stage);
      await delay(signal);
    }
  } catch {
    signal.throwIfAborted();
    return { id: orderId, status: 'unknown', errorMessage: UNCERTAIN };
  }
  signal.throwIfAborted();
}

export function useShoot(visible) {
  const [shoot, setShoot] = useState(EMPTY);
  const active = useRef(null);
  useLayoutEffect(() => () => { active.current?.abort(); }, [visible]);

  function reset() {
    if (!active.current) setShoot(EMPTY);
  }

  async function run(body, poses) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const slots = poses ?? [null];
    const shots = slots.map(posePreset => ({ posePreset, status: 'pending' }));
    flushSync(() => setShoot({ ...EMPTY, busy: true, batch: Boolean(poses), stage: 'queued', shots, model: body.model, count: body.pieces.length, background: body.studioPreset, original: body.person }));
    try {
      for (const [index, posePreset] of slots.entries()) {
        controller.signal.throwIfAborted();
        setShoot(current => ({ ...current, index, stage: 'queued' }));
        const order = await settleOrder(posePreset ? { ...body, posePreset } : body, controller.signal, stage => {
          setShoot(current => current.stage === stage ? current : { ...current, stage });
        });
        controller.signal.throwIfAborted();
        const uncertain = order.status === 'unknown';
        setShoot(current => ({ ...current, shots: current.shots.map((item, position) => position === index ? { ...order, posePreset }
          : uncertain && position > index ? { ...item, status: 'skipped' } : item) }));
        if (uncertain) break;
      }
    } catch (failure) {
      if (!controller.signal.aborted) throw failure;
      setShoot(current => ({ ...current, busy: false, shots: current.shots.map((shot, position) => shot.status !== 'pending' ? shot : position === current.index
        ? { ...shot, status: 'unknown', errorMessage: UNCERTAIN } : { ...shot, status: 'skipped' }) }));
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setShoot(current => ({ ...current, busy: false }));
    }
  }
  return { shoot, run, reset };
}
