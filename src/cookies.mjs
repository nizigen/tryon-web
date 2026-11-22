/**
 * 本地登录态 cookie：把用户从浏览器 DevTools 复制的 Cookie 整串按平台存成一张表。
 *
 * 文件默认在 `<cwd>/data/cookies.json`，形如：
 * {
 *   "taobao": "_m_h5_tk=...; _tb_token_=...; cookie2=...",
 *   "douyin": "sessionid=...; ttwid=..."
 * }
 * 只存本机、只用于直连请求；不进 git（.gitignore 已忽略 data/cookies.json）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function cookieFilePath(env = process.env, cwd = process.cwd()) {
  return env.TRYON_COOKIE_FILE || join(cwd, 'data', 'cookies.json');
}

/** 读取某平台的 cookie 头；没有就返回空串。永不抛错，坏文件按没有处理。 */
export function loadCookies(env = process.env, cwd = process.cwd()) {
  const file = cookieFilePath(env, cwd);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [platform, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) out[platform] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}
