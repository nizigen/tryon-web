import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError } from './errors.mjs';
import { generateImage } from './the image service.mjs';

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const JOB_RETENTION_MS = 30 * 60 * 1000;

export function createTryonService({ store, env, fetchImpl, resultsDir, timeoutMs = 120_000, concurrency = 2, logger = console }) {
  const jobs = new Map();
  const reservations = new Set();
  const pending = [];
  let running = 0;

  function activeJobFor(sessionId) {
    return [...jobs.values()].find((job) => job.sessionId === sessionId && (job.status === 'queued' || job.status === 'running')) ?? null;
  }

  /** 先占位再扣费：占位成功后才允许扣费与建单，避免并发窗口里吞钱。 */
  function reserve(sessionId) {
    if (activeJobFor(sessionId) || reservations.has(sessionId)) {
      throw new HttpError(409, 'BUSY', '已有试穿任务正在进行，请等待完成');
    }
    reservations.add(sessionId);
  }

  function release(sessionId) {
    reservations.delete(sessionId);
  }

  async function writeResult(orderId, mimeType, buffer) {
    await mkdir(resultsDir, { recursive: true });
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
    const file = `${orderId}.${extension}`;
    await writeFile(join(resultsDir, file), buffer);
    return file;
  }

  async function settleFailure(job, error) {
    const known = error instanceof HttpError;
    const order = store.getOrder(job.orderId);
    // 先完成退款与订单落库，再把任务置为失败，避免外部读到“失败”但额度未退回。
    if (order) {
      await store.updateOrder(order.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorCode: known ? error.code : 'INTERNAL_ERROR',
        errorMessage: known ? error.message : '试穿生成失败，请稍后重试',
      });
      if (order.priceCents > 0) await store.addBalance(order.sessionId, order.priceCents);
    }
    job.status = 'failed';
    job.stage = 'failed';
    job.error = { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '试穿生成失败，请稍后重试' };
    job.updatedAt = new Date().toISOString();
  }

  async function runJob(job) {
    job.status = 'running';
    job.stage = 'generating';
    job.updatedAt = new Date().toISOString();
    try {
      const { model, prompt, person, garment, referenceImages, quality, size } = job.payload;
      // referenceImages 为多件穿搭提供的完整参考图数组；缺省时退回旧单件 [person, garment]。
      const images = Array.isArray(referenceImages) ? referenceImages : [person, garment];
      const { mimeType, buffer } = await generateImage({
        model,
        prompt,
        referenceImages: images,
        quality,
        size,
      }, env, fetchImpl, { timeoutMs });
      job.stage = 'finalizing';
      const file = await writeResult(job.orderId, mimeType, buffer);
      await store.updateOrder(job.orderId, { status: 'success', finishedAt: new Date().toISOString(), resultFile: file });
      job.status = 'success';
      job.stage = 'success';
      job.resultFile = file;
    } catch (error) {
      await settleFailure(job, error);
    } finally {
      job.payload = null;
      job.updatedAt = new Date().toISOString();
      running -= 1;
      pump();
    }
  }

  function pump() {
    while (running < concurrency && pending.length > 0) {
      const job = pending.shift();
      running += 1;
      void runJob(job).catch((error) => {
        logger.error(`tryon job crashed: ${error.message}`);
        running -= 1;
        pump();
      });
    }
  }

  function pruneJobs() {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of jobs) {
      if ((job.status === 'success' || job.status === 'failed') && new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id);
    }
  }

  return {
    reserve,
    release,

    enqueue({ orderId, sessionId, payload, start = true }) {
      if (activeJobFor(sessionId)) throw new HttpError(409, 'BUSY', '已有试穿任务正在进行，请等待完成');
      const job = {
        id: randomUUID(),
        orderId,
        sessionId,
        status: 'queued',
        stage: 'queued',
        error: null,
        resultFile: null,
        payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);
      reservations.delete(sessionId);
      pending.push(job);
      pruneJobs();
      // start=false 时先排队不启动：调用方还要把 jobId 落库，落库成功后再 start。
      // 这样「订单已建但 jobId 没写进订单」的窗口里不会已经开始消耗上游额度。
      if (start) pump();
      return job;
    },

    /** 启动一个排队中的任务；已经启动或已完成则什么也不做。 */
    start(jobId) {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') return;
      pump();
    },

    /** 撤销一个尚未开始的任务（用于下单过程中途失败的回滚）。 */
    cancel(jobId, reason = 'CANCELLED') {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') return false;
      const index = pending.indexOf(job);
      if (index >= 0) pending.splice(index, 1);
      job.status = 'failed';
      job.stage = 'failed';
      job.error = { code: reason, message: '本次试穿已取消' };
      job.payload = null;
      job.updatedAt = new Date().toISOString();
      return true;
    },

    getJob(id) {
      return jobs.get(id) ?? null;
    },

    jobsForSession(sessionId) {
      return [...jobs.values()].filter((job) => job.sessionId === sessionId);
    },

    /** 进程重启后没有内存任务，磁盘上的 pending 订单需要人工对账为失败并退费。 */
    async reconcileInterruptedOrders() {
      const stale = store.listAllOrders().filter((order) => order.status === 'pending');
      for (const order of stale) {
        await store.updateOrder(order.id, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          errorCode: 'INTERRUPTED',
          errorMessage: '服务重启导致本次试穿中断，费用已退回余额',
        });
        if (order.priceCents > 0) await store.addBalance(order.sessionId, order.priceCents);
      }
      return stale.length;
    },

    async cleanupExpiredResults() {
      const files = await readdir(resultsDir).catch(() => []);
      for (const file of files) {
        const path = join(resultsDir, file);
        const stats = await stat(path).catch(() => null);
        if (!stats || Date.now() - stats.mtimeMs <= RESULT_TTL_MS) continue;
        await unlink(path).catch(() => {});
        const order = store.listAllOrders().find((item) => item.resultFile === file);
        if (order && order.status === 'success') {
          await store.updateOrder(order.id, { status: 'expired', errorCode: 'RESULT_EXPIRED', errorMessage: '试穿结果已过期清理' });
        }
      }
    },
  };
}
