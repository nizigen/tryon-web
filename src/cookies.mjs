/**
 * 本地登录态 cookie：把用户从浏览器 DevTools 复制的 Cookie 整串按平台存成一张表。
 *
 * 文件默认在 `<dataDir>/cookies.json`，形如：
 * {
 *   "taobao": "_m_h5_tk=...; _tb_token_=...; cookie2=...",
 *   "douyin": "sessionid=...; ttwid=..."
 * }
 * 只存本机、只用于直连请求；不进 git（.gitignore 已忽略 data/cookies.json）。
 *
 * 第二个参数是**数据目录**（不是 cwd）：扫码登录写文件、设置页读状态、商品解析读 cookie
 * 三处必须指向同一个绝对路径，否则从仓库根以外启动时会出现「登录成功但一直显示未配置」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function cookieFilePath(env = process.env, dataDir = join(process.cwd(), 'data')) {
  return env.TRYON_COOKIE_FILE || join(dataDir, 'cookies.json');
}

/** 读取某平台的 cookie 头；没有就返回空串。永不抛错，坏文件按没有处理。 */
export function loadCookies(env = process.env, dataDir = join(process.cwd(), 'data')) {
  const file = cookieFilePath(env, dataDir);
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
