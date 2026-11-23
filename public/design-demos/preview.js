const direction = document.body.dataset.direction || 'a';
const names = { a: 'A · 摄影工作台', b: 'B · 衣橱搭配室', c: 'C · 轻量分步试穿' };
const paths = { hanger: '<path d="M9 6a3 3 0 1 1 4 2.8V11l8 5a2 2 0 0 1-1 4H4a2 2 0 0 1-1-4l9-5"/>', studio: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 17h8M12 9v6"/>', wardrobe: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18M9 11v2m6-2v2"/>', settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--paper)"/><circle cx="16" cy="12" r="2" fill="var(--paper)"/><circle cx="10" cy="18" r="2" fill="var(--paper)"/>', orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>', plus: '<path d="M12 5v14M5 12h14"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', check: '<path d="m5 12 4 4L19 6"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>', link: '<path d="m10 13 4-4m-6 5-2 2a3 3 0 0 0 4 4l4-4m-4-8 4-4a3 3 0 0 1 4 4l-2 2"/>', edit: '<path d="m15 4 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15z"/>', trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>', sparkle: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>', back: '<path d="m14 5-7 7 7 7"/>', image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>' };
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.image}</svg>`;
const allowedTags = new Set('a article aside button circle div footer form h1 h2 h3 header img input label main nav option p path rect section select small span strong svg textarea'.split(' '));
const allowedAttributes = new Set('class id type value maxlength placeholder selected role tabindex alt viewbox d cx cy r x y width height rx fill stroke hidden'.split(' '));
function setContent(element, markup) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  for (const node of parsed.body.querySelectorAll('*')) {
    if (!allowedTags.has(node.localName)) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) {
      const { name, value } = attribute;
      if (name === 'href' || name === 'src') {
        if (!/^(?:\/(?!\/)|#|\.\/|blob:)/.test(value)) node.removeAttribute(name);
      } else if (!allowedAttributes.has(name.toLowerCase()) && !/^(?:aria-|data-)[a-z-]+$/.test(name)) node.removeAttribute(name);
    }
  }
  element.replaceChildren(...parsed.body.childNodes);
}
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let items = [
  { id: 1, name: '亚麻白衬衫', category: '上衣', detail: '衬衫', image: 'blouse-linen' },
  { id: 2, name: '黑色直筒牛仔裤', category: '下装', detail: '牛仔裤', image: 'jeans-black' },
  { id: 3, name: '奶油色针织衫', category: '上衣', detail: '针织衫', image: 'sweater-knit' },
  { id: 4, name: '灰色百褶半身裙', category: '下装', detail: '半身裙', image: 'skirt-pleated' },
  { id: 5, name: '黑色缎面吊带裙', category: '连衣裙', detail: '吊带裙', image: 'dress-slip' },
  { id: 6, name: '红色花卉衬衫', category: '上衣', detail: '衬衫', image: 'shirt-floral' },
];
let selected = [1, 2];
let filter = '全部';
let query = '';
let step = 0;
let fit = '合身';
let notes = '';
let resultView = false;
let personUrl = '/model/model-front.png';
let timer;
const img = item => `/catalog/${item.image}.jpg`;
const nav = [['studio', 'studio', '试穿工作台'], ['wardrobe', 'wardrobe', '我的衣橱'], ['settings', 'settings', '设置'], ['orders', 'orders', '试穿记录']];
let route = location.hash.slice(1) || (direction === 'b' ? 'wardrobe' : 'studio');
const button = (text, action, primary = false, glyph = '') => `<button class="button${primary ? ' primary' : ''}" data-action="${action}">${glyph ? icon(glyph) : ''}${text}</button>`;
const heading = (title, sub, actions = '') => `<header class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</header>`;
function notify(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { node.hidden = true; }, 3500);
}
function render() {
  if (!nav.some(n => n[0] === route)) route = 'studio';
  document.title = `${names[direction]} · 搭配试穿间设计预览`;
  document.body.className = `direction-${direction}`;
  setContent(document.getElementById('app'), `<div class="review-banner"><span>${names[direction]} · 设计预览，单品为样例素材</span><a href="./index.html">比较三个方向</a></div><div class="shell"><aside class="side"><a href="#studio" class="brand">${icon('hanger')}<span>搭配试穿间<small>穿之前，先看看</small></span></a><nav aria-label="主导航">${nav.map(([key, glyph, text]) => `<button class="nav-button ${route === key ? 'active' : ''}" data-route="${key}" ${route === key ? 'aria-current="page"' : ''}>${icon(glyph)}${text}</button>`).join('')}</nav><div class="side-bottom"><div class="balance"><span class="muted small">预览余额</span><strong class="num">¥6.90</strong></div><p class="muted small side-note">试穿结果为 AI 生成<br>人物照仅用于本次试穿</p></div></aside><main class="workspace" id="main">${route === 'studio' ? studio() : route === 'wardrobe' ? wardrobe() : route === 'settings' ? settings() : orders()}</main></div><nav class="bottom-nav" aria-label="移动端主导航">${nav.map(([key, glyph, text]) => `<button class="${route === key ? 'active' : ''}" data-route="${key}" ${route === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${key === 'studio' ? '试穿' : key === 'wardrobe' ? '衣橱' : key === 'orders' ? '记录' : text}</span></button>`).join('')}</nav>`);
}
function personChip() {
  return `<div class="person-chip"><img src="${personUrl}" alt="当前试穿人物"><div><h3>${personUrl.startsWith('blob:') ? '你的照片' : '内置模特'}</h3><p class="muted small">${personUrl.startsWith('blob:') ? '照片仅在本次预览使用' : '也可以换成自己的全身照'}</p></div><button class="icon-button" data-action="upload-person" aria-label="更换人物照片">${icon('upload')}</button></div>`;
}
function pieces() {
  const current = items.filter(i => selected.includes(i.id));
  return `<div>${current.map(i => `<div class="selected-piece"><img class="piece-thumb" src="${img(i)}" alt="${escape(i.name)}"><div class="piece-copy"><h3>${escape(i.name)}</h3><p>${i.category} / ${i.detail}</p></div><button class="icon-button" data-remove="${i.id}" aria-label="从本套搭配移除${escape(i.name)}">${icon('close')}</button></div>`).join('')}${!current.length ? '<p class="muted">选一件想试的衣服，开始这套搭配。</p>' : ''}<button class="add-piece" data-action="picker">${icon('plus')}从衣橱添加单品 <span class="small">${current.length}/5</span></button></div>`;
}
function preferences() {
  return `<div class="field"><label>你希望的版型</label><div class="fit-options" role="group" aria-label="版型">${['修身', '合身', '宽松'].map(t => `<button data-fit="${t}" class="${fit === t ? 'active' : ''}" aria-pressed="${fit === t}">${t}</button>`).join('')}</div></div><div class="field"><label for="notes">补充要求 <span class="muted small">选填</span></label><textarea id="notes" class="input" maxlength="500" placeholder="例如：衬衫下摆自然垂落，保留布料质感">${escape(notes)}</textarea></div>`;
}
function submit() {
  return `<div class="submit-area">${button('生成试穿图', 'generate', true, 'sparkle')}<p>下单前确认价格 · 失败全额退回</p></div>`;
}
function stage() {
  return `<section class="panel stage-panel" aria-label="人物预览"><div class="stage-toolbar"><span class="muted small">人物预览</span><div class="segments" aria-label="预览模式"><button class="${!resultView ? 'active' : ''}" data-preview="person">原图</button><button class="${resultView ? 'active' : ''}" data-preview="result">试穿结果</button></div></div><div class="stage">${resultView ? `<div class="empty-result">${icon('image')}<h2>新的搭配，会在这里呈现</h2><p class="muted">准备好人物与单品后，生成试穿图。</p><p class="muted small">设计预览不调用生成服务</p></div>` : `<img class="person" src="${personUrl}" alt="内置模特原图，尚未生成试穿结果"><span class="stage-label">${personUrl.startsWith('blob:') ? '你的照片' : '内置模特'} · 原图</span>`}</div><div class="stage-foot">${button('更换照片', 'upload-person', false, 'upload')}<span class="stage-help">${icon('shield')}照片仅用于本次生成</span></div></section>`;
}
function studio() {
  if (direction === 'c') return guidedStudio();
  return `<div class="studio-page">${heading('试穿工作台', '把喜欢的单品搭在一起，看看穿在身上的样子。', button('从商品链接添加', 'import', false, 'link'))}<div class="studio-layout">${stage()}<div class="outfit-controls"><section class="panel"><div class="section-head"><h2>试穿人物</h2></div>${personChip()}</section><section class="panel"><div class="section-head"><h2>这一套怎么穿</h2><span class="tag">${selected.length} 件单品</span></div>${pieces()}</section><section class="panel stack">${preferences()}</section>${submit()}<div class="tip">${icon('shield')}AI 生成效果仅供搭配参考，不代表实际尺码与合身度。</div></div></div></div>`;
}
function guidedStudio() {
  const title = ['选择试穿人物', '搭配想穿的单品', '确认这套搭配'][step];
  const body = step === 0 ? `${personChip()}${button('换成我的照片', 'upload-person', false, 'upload')}<p class="muted">建议使用正面全身照，站姿自然、背景简洁。你也可以直接用内置模特继续。</p><div class="tip">${icon('shield')}照片仅用于生成，不保存到衣橱或订单。</div>` : step === 1 ? `${pieces()}${button('从商品链接添加', 'import', false, 'link')}<p class="muted small">一套最多 5 件，支持上衣、外套、下装、连衣裙、袜、鞋和配饰。</p>` : `${preferences()}<p class="muted">本次搭配 ${selected.length} 件单品 · 默认图像模型</p><div class="tip">${icon('shield')}下单前确认价格，生成失败全额退回。</div>`;
  return `<div class="studio-page">${heading('开始一次新试穿', '从一张照片、一套衣服开始。')}<div class="guide-steps" aria-label="试穿步骤">${['选人物', '搭单品', '生成试穿'].map((t, i) => `${i ? '<span class="step-line"></span>' : ''}<button data-step="${i}" class="${step === i ? 'active' : ''}" ${step === i ? 'aria-current="step"' : ''}><span class="step-number">${step > i ? icon('check') : i + 1}</span>${t}</button>`).join('')}</div><div class="studio-layout">${stage()}<div class="outfit-controls"><section class="panel step-panel"><h2>${title}</h2>${body}</section><div class="step-nav">${step > 0 ? button('上一步', 'previous') : ''}${button(step === 2 ? '生成试穿图' : '下一步', step === 2 ? 'generate' : 'next', true, step === 2 ? 'sparkle' : '')}</div><p class="muted small">${step === 0 ? 'PNG / JPEG / WebP，不超过 8 MB' : '设计预览 · 不调用付费生成服务'}</p></div></div></div>`;
}
function garment(item) {
  const on = selected.includes(item.id);
  return `<article class="garment ${on ? 'is-selected' : ''}" data-card="${item.id}"><button class="garment-photo" data-pick="${item.id}" aria-label="${on ? '移除' : '选入搭配'}${escape(item.name)}" aria-pressed="${on}"><img src="${img(item)}" alt="${escape(item.name)}">${on ? `<span class="pick-check">${icon('check')}</span>` : ''}</button><div class="garment-info"><div><h3>${escape(item.name)}</h3><p>${item.category} / ${item.detail}</p></div><button class="icon-button garment-more" data-menu="${item.id}" aria-label="${escape(item.name)}的更多操作" aria-expanded="false">${icon('more')}</button></div></article>`;
}
function wardrobe() {
  const visible = items.filter(i => (filter === '全部' || i.category === filter) && i.name.includes(query));
  return `<div class="wardrobe-page">${heading('我的衣橱', `${items.length} 件单品，让已有的衣服搭出新可能。`, button('链接导入', 'import', false, 'link') + button('上传单品', 'upload-garment', true, 'plus'))}<div class="closet-content"><div class="wardrobe-toolbar"><div class="filters" aria-label="筛选单品">${['全部', '上衣', '下装', '连衣裙'].map(t => `<button class="${filter === t ? 'active' : ''}" data-filter="${t}" aria-pressed="${filter === t}">${t}</button>`).join('')}</div><form class="search" id="search-form">${icon('search')}<input class="input" id="search" aria-label="搜索衣橱" placeholder="搜索单品" value="${escape(query)}"></form></div><div class="wardrobe-grid">${visible.length ? visible.map(garment).join('') : '<div class="empty-state"><h2>还没有找到这件单品</h2><p class="muted">换个关键词，或添加一件新衣服。</p></div>'}</div><div class="closet-footer"><div><h3>已选 ${selected.length} 件，组成这一套</h3><p>点单品图片加入搭配，更多操作收在右侧菜单中。</p></div>${button('去试穿', 'go-studio', true, 'studio')}</div><section class="panel daily-outfit"><div class="section-head"><div><h2>今日穿搭</h2><p class="muted">说说场合，让 AI 从衣橱里帮你搭一套。</p></div>${icon('sparkle')}</div><div class="field"><label for="occasion">这次想怎么穿</label><div class="row"><input id="occasion" class="input" placeholder="例如：明天通勤，想穿得轻松一点">${button('帮我选', 'suggest')}</div></div></section></div><aside class="wardrobe-aside"><div class="mini-stage"><img class="person" src="${personUrl}" alt="试穿人物原图"><span class="stage-label">人物原图</span></div><section class="panel"><div class="section-head"><h2>正在搭配</h2><span class="small muted">${selected.length} / 5</span></div>${pieces()}</section>${button('看看上身效果', 'go-studio', true, 'sparkle')}<p class="muted small">预览使用仓库已有示例单品；生成后才显示试穿结果。</p></aside></div>`;
}
function settings() {
  return `${heading('设置', '选择生成模型，管理商品来源的连接状态。')}<div class="settings-layout"><section class="settings-section"><div><h2>试穿生成</h2><p>这里的选择会用于下一次试穿。</p></div><div class="panel stack"><div class="field"><label for="model">图像模型</label><select id="model" class="input"><option>GPT Image 2.5</option><option>GPT Image 1</option></select></div><p class="muted small" id="saved-status" role="status">修改后自动保存 · 当前为设计预览</p><div class="setting-row"><span>图片服务</span><span class="tag">预览未检测</span></div></div></section><section class="settings-section"><div><h2>商品来源</h2><p>需要登录的平台，会在导入商品时使用对应的登录状态。</p></div><div class="panel">${['淘宝 / 天猫', '京东', '拼多多', '抖音商城'].map(t => `<div class="setting-row"><div><h3>${t}</h3><p class="muted small">${t === '抖音商城' ? '商品分享链接' : '预览未检测登录状态'}</p></div>${t === '抖音商城' ? '<span class="muted small">无需登录</span>' : button('扫码登录', 'login')}</div>`).join('')}<p class="muted small" style="margin-top:14px">只显示登录状态，不展示账号凭据。</p></div></section><section class="settings-section"><div><h2>关于试穿</h2><p>了解生成结果与照片的使用方式。</p></div><div class="panel explain"><div><h3>你的照片</h3><p>仅用于本次生成，不写入订单记录。</p></div><div><h3>AI 生成结果</h3><p>生成结果保留 24 小时，请及时下载；搭配效果仅供参考。</p></div></div></section></div>`;
}
function orders() {
  return `${heading('试穿记录', '回看试穿订单与生成状态。')}<div class="order-layout"><section class="panel"><div class="section-head"><h2>最近的试穿</h2><span class="muted small">暂无记录</span></div><div class="empty-state">${icon('orders')}<h2>第一套新搭配，从这里开始</h2><p class="muted">完成一次试穿后，会在这里留下订单记录。</p>${button('去搭一套', 'go-studio', true)}</div></section><aside class="panel"><div class="order-summary"><p class="muted small">预览余额</p><strong class="num">¥6.90</strong></div><div class="explain"><div><h3>按次计费</h3><p>生成前确认所需金额，成功后实扣。</p></div><div><h3>失败会退回</h3><p>生成失败或超时，全额退回冻结金额。</p></div><div><h3>及时保存结果</h3><p>生成图片保留 24 小时，下载文件标注 AI 生成。</p></div></div></aside></div>`;
}
const dialog = document.getElementById('dialog');
function openDialog(title, content, footer) {
  setContent(dialog, `<header class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="关闭弹窗">${icon('close')}</button></header><div class="dialog-body">${content}</div><footer class="dialog-foot">${footer}</footer>`);
  dialog.showModal();
}
function importDialog() {
  openDialog('从商品链接添加', '<p class="muted">复制商品分享链接或整段分享文案，导入你想试的单品。</p><div class="import-options"><span>淘宝 / 天猫</span><span>京东</span><span>拼多多</span><span>抖音商城</span></div><div class="field"><label for="product-url">商品链接</label><textarea class="input" id="product-url" placeholder="把单个商品的分享链接粘贴到这里"></textarea><p class="muted small">暂不支持博主主页与整个橱窗链接。</p></div><div class="preview-note">此弹窗演示布局与状态，确认后展示示例解析结果。</div>', button('取消', 'close') + button('预览解析结果', 'parse', true));
}
function picker() {
  openDialog('从衣橱挑选', `<p class="muted">挑选后加入当前这套搭配，最多 5 件。</p><div class="dialog-picker">${items.map(i => `<button data-picker="${i.id}"><img src="${img(i)}" alt=""><span>${escape(i.name)}</span></button>`).join('')}</div>`, button('完成', 'close'));
}
function editDialog(id) {
  const i = items.find(i => i.id === id);
  openDialog('编辑单品', `<div class="import-result"><img src="${img(i)}" alt="${escape(i.name)}"><p class="muted small">修改名称与类目，方便下次找衣服。</p></div><div class="field"><label for="item-name">单品名称</label><input class="input" id="item-name" value="${escape(i.name)}" maxlength="80"></div><div class="field"><label for="item-category">类目</label><select class="input" id="item-category">${['上衣', '外套', '下装', '连衣裙', '袜', '鞋', '配饰'].map(t => `<option ${t === i.category ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="field"><label for="item-detail">子类</label><select class="input" id="item-detail">${[i.detail, '其他'].map(t => `<option>${t}</option>`).join('')}</select></div><p class="preview-note">只修改本页预览样例，刷新后恢复。</p>`, button('取消', 'close') + `<button class="button primary" data-save="${id}">保存修改</button>`);
}
function toggle(id) {
  if (selected.includes(id)) selected = selected.filter(n => n !== id);
  else if (selected.length < 5) selected = [...selected, id];
  else { notify('每套最多选 5 件单品'); return; }
  render();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button,[data-route]');
  if (!target) {
    document.querySelectorAll('.menu').forEach(n => n.remove());
    document.querySelectorAll('[data-menu]').forEach(n => n.setAttribute('aria-expanded', 'false'));
    return;
  }
  const d = target.dataset;
  if (d.route) { location.hash = d.route; return; }
  if (d.pick) { toggle(Number(d.pick)); return; }
  if (d.remove) { selected = selected.filter(n => n !== Number(d.remove)); render(); return; }
  if (d.filter) { filter = d.filter; render(); return; }
  if (d.fit) { fit = d.fit; render(); return; }
  if (d.step !== undefined) { step = Number(d.step); render(); return; }
  if (d.preview) { resultView = d.preview === 'result'; render(); return; }
  if (d.menu) {
    const expanded = target.getAttribute('aria-expanded') === 'true';
    document.querySelectorAll('.menu').forEach(n => n.remove());
    document.querySelectorAll('[data-menu]').forEach(n => n.setAttribute('aria-expanded', 'false'));
    if (expanded) return;
    target.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('aria-label', '单品操作');
    setContent(menu, `<button data-edit="${Number(d.menu)}">${icon('edit')}编辑单品</button><button class="danger" data-delete="${Number(d.menu)}">${icon('trash')}删除单品</button>`);
    target.closest('.garment').append(menu); menu.querySelector('button').focus(); return;
  }
  if (d.edit) { editDialog(Number(d.edit)); return; }
  if (d.delete) {
    const i = items.find(i => i.id === Number(d.delete));
    openDialog('删除这件单品？', `<p>「${escape(i.name)}」将从衣橱移除。已有试穿订单不受影响。</p><p class="preview-note">这是预览样例操作，不会删除你的真实衣橱。</p>`, button('保留单品', 'close') + `<button class="button danger" data-confirm-delete="${i.id}">删除单品</button>`); return;
  }
  if (d.confirmDelete) { const id = Number(d.confirmDelete); items = items.filter(i => i.id !== id); selected = selected.filter(n => n !== id); dialog.close(); render(); notify('已从预览衣橱移除，刷新可恢复'); return; }
  if (d.save) {
    const name = document.getElementById('item-name').value.trim();
    if (!name) { document.getElementById('item-name').setCustomValidity('请填写单品名称'); document.getElementById('item-name').reportValidity(); return; }
    const category = document.getElementById('item-category').value;
    const detail = document.getElementById('item-detail').value;
    items = items.map(i => i.id === Number(d.save) ? { ...i, name, category, detail } : i);
    dialog.close(); render(); notify('样例修改已保存'); return;
  }
  if (d.picker) { toggle(Number(d.picker)); dialog.close(); notify('搭配已更新'); return; }
  switch (d.action) {
    case 'close': dialog.close(); break;
    case 'import': importDialog(); break;
    case 'parse': openDialog('选择商品图片', `<p class="preview-note">示例解析结果，未发送外部商品请求。</p><div class="import-result"><img src="/catalog/blouse-linen.jpg" alt="示例白衬衫"><div><h3>亚麻白衬衫</h3><p class="muted small">1 张示例商品图片</p></div></div><div class="field"><label for="import-name">单品名称</label><input class="input" id="import-name" value="亚麻白衬衫"></div><div class="field"><label for="import-category">类目</label><select class="input" id="import-category"><option>上衣 / 衬衫</option><option>外套</option></select></div>`, button('重新粘贴', 'import') + button('加入衣橱', 'import-done', true)); break;
    case 'import-done': dialog.close(); route = 'wardrobe'; location.hash = 'wardrobe'; render(); notify('已预览加入流程，正式版将写入真实衣橱'); break;
    case 'picker': picker(); break;
    case 'suggest': selected = items.slice(0, 2).map(i => i.id); render(); notify('已展示示例搭配，正式版会根据需求调用 AI 选搭'); break;
    case 'go-studio': location.hash = 'studio'; break;
    case 'next': step = Math.min(2, step + 1); render(); break;
    case 'previous': step = Math.max(0, step - 1); render(); break;
    case 'generate': openDialog('生成前确认', `<p>本套共 ${selected.length} 件单品，使用${personUrl.startsWith('blob:') ? '你的照片' : '内置模特'}。</p><p class="preview-note">这是设计预览，不会扣费或调用图片服务。正式版将在这里展示准确的单次价格。</p>`, button('继续调整', 'close') + button('查看结果空状态', 'result', true)); break;
    case 'result': dialog.close(); resultView = true; render(); notify('预览结果区；尚未生成图片'); break;
    case 'login': openDialog('扫码登录', '<p>正式版会在这里展示平台二维码与等待扫码、成功、超时状态。</p><p class="preview-note">设计预览不发起账号登录。</p>', button('关闭', 'close', true)); break;
    case 'upload-person': document.getElementById('person-file').click(); break;
    case 'upload-garment': document.getElementById('garment-file').click(); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'notes') notes = e.target.value;
  if (e.target.id === 'search') {
    query = e.target.value;
    const start = e.target.selectionStart;
    render(); const input = document.getElementById('search'); input.focus(); input.setSelectionRange(start, start);
  }
});
document.addEventListener('submit', e => { if (e.target.id === 'search-form') e.preventDefault(); });
document.addEventListener('change', e => {
  if (e.target.id === 'model') { document.getElementById('saved-status').textContent = '已更新预览选择，真实配置未修改'; notify('预览模型已切换'); }
  if (e.target.id === 'item-category') setContent(document.getElementById('item-detail'), '<option>请选择子类</option><option>其他</option>');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelectorAll('.menu').forEach(n => n.remove()); document.querySelectorAll('[data-menu]').forEach(n => n.setAttribute('aria-expanded', 'false')); }
});
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
document.getElementById('person-file').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { notify('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片'); return; }
  if (personUrl.startsWith('blob:')) URL.revokeObjectURL(personUrl);
  personUrl = URL.createObjectURL(file); resultView = false; render(); notify('人物照片已替换，仅在当前预览使用');
});
document.getElementById('garment-file').addEventListener('change', e => { if (e.target.files[0]) notify('上传入口已演示；正式版会在此识别类目并保存单品'); });
window.addEventListener('hashchange', () => { route = location.hash.slice(1); render(); window.scrollTo(0, 0); });
render();
