import { useEffect, useRef, useState } from 'react';

import { api } from '../public/lib/api.js';
import { CapsuleSelect, errorText, toast } from './ui.jsx';

const sources = { taobao: '淘宝', jd: '京东', pdd: '拼多多', douyin: '抖音' };

function Pill({ value, known = true }) {
  return <span className={`status-pill ${value ? 'is-on' : 'is-off'}`}>{known ? (value ? '已配置' : '未配置') : '未知'}</span>;
}

function SourceRow({ platform, configured, known }) {
  const [login, setLogin] = useState({ phase: 'idle', message: '' });
  const [sessionId, setSessionId] = useState(null);
  const alive = useRef(false);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const deadline = Date.now() + 360000;
    let timer;
    async function poll() {
      try {
        const result = await api(`/api/login/${platform}/status?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.status === 'waiting' && Date.now() < deadline) { timer = setTimeout(poll, 1500); return; }
        if (result.status === 'done') {
          setLogin({ phase: 'done', message: result.account ? `已登录（${result.account}）` : '已登录' });
          toast(`${sources[platform]}登录成功`);
        } else setLogin({ phase: 'failed', message: result.status === 'failed' ? '登录失败，请重新扫码。' : '登录已超时，请重新扫码。' });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLogin({ phase: 'failed', message: errorText(error) });
      }
      busy.current = false;
      setSessionId(null);
    }
    timer = setTimeout(poll, 1500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [platform, sessionId]);
  async function start() {
    if (busy.current) return;
    busy.current = true;
    setLogin({ phase: 'starting', message: '正在准备扫码…' });
    try {
      const result = await api(`/api/login/${platform}`, { method: 'POST' });
      if (!alive.current) return;
      setLogin({ phase: 'waiting', message: '等待扫码…' });
      setSessionId(result.sessionId);
      toast(`请在打开的浏览器中扫码登录${sources[platform]}`);
    } catch (error) {
      if (alive.current) { setLogin({ phase: 'failed', message: errorText(error) }); busy.current = false; }
    }
  }
  const buttonText = { waiting: '等待扫码…', done: '已完成', starting: '启动中…' }[login.phase];
  return <div className="login-row"><span className="login-row__label">{sources[platform]}</span><Pill known={known || login.phase === 'done'} value={configured || login.phase === 'done'} />
    {platform === 'douyin' ? <span className="field__hint login-row__hint">无需登录</span> : <div className="login-row__action">
      <button type="button" className="btn btn--sm" disabled={Boolean(buttonText)} onClick={start}>{buttonText || '扫码登录'}</button>
      <span className="login-row__status" aria-live="polite">{login.message}</span></div>}</div>;
}

function SettingsSection({ title, description, children }) {
  return <section className="settings__section">
    <div className="settings__heading"><h2 className="section__title">{title}</h2><p className="section__hint">{description}</p></div>
    <div className="settings__body">{children}</div>
  </section>;
}

export default function Settings({ ctx }) {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const { settings, config, setSettings } = ctx;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api('/api/settings', { signal: controller.signal }).then(setSettings).catch(failure => {
      if (!controller.signal.aborted) setError(errorText(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);
  const models = settings?.models ?? config.models ?? [];
  const reachable = (settings?.gateway ?? config.gateway)?.reachable;
  async function save(model) {
    setSaving(true);
    try {
      const result = await api('/api/settings', { method: 'PATCH', body: { model } });
      setSettings({ ...settings, models, model: result.model });
      toast('模型已切换');
    } catch (failure) { toast(errorText(failure)); }
    finally { setSaving(false); }
  }
  return <><section className="page-head"><h1 className="page-title">设置</h1><p className="page-sub">管理试穿模型和商品来源。</p></section>
    <div className="settings">{error && <div className="empty"><p className="empty__title">设置暂时读取不到</p><p>{error}</p>
      <button type="button" className="btn btn--sm" onClick={() => { setError(''); setReload(value => value + 1); }}>重新加载</button></div>}
      <SettingsSection title="图像模型" description="普通试穿和棚拍使用同一个模型。"><div className="field"><span className="field__label">用于下一次试穿</span>
        <CapsuleSelect options={models.map(model => ({ value: model.id, label: model.label || model.id }))} value={ctx.model ?? ''} disabled={loading || saving || !models.length}
          ariaLabel="图像模型" placeholder="选择图像模型" onChange={save} /></div></SettingsSection>
      <SettingsSection title="图片服务" description="生成试穿图需要连接图片服务。"><div className="kv"><span className="kv__label">连通状态</span>
        <span className={`status-pill ${reachable ? 'is-on' : 'is-off'}`}>{reachable == null ? '未知' : reachable ? '已连通' : '未连接'}</span></div></SettingsSection>
      <SettingsSection title="商品来源" description="有些平台需要先登录才能读取商品图片。">{Object.keys(sources).map(platform =>
        <SourceRow key={platform} platform={platform} configured={settings?.sources?.[platform]} known={settings?.sources != null} />)}</SettingsSection>
    </div></>;
}
