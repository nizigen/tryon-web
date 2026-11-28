import {
  ACCEPTED_IMAGES,
  LAYER_LABELS,
  MAX_PIECES,
  recommendedPosesFor,
  selectedPiecesFromEntries,
  validateStudioDraft,
} from './shell-state.js';
import { DEFAULT_PERSON_URL, BASE_FACE_URL, TURNAROUND_URL } from './mock-data.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NAV_ITEMS = [
  { route: 'studio', label: '试穿工作台' },
  { route: 'wardrobe', label: '我的衣橱' },
  { route: 'shop', label: '示例橱窗' },
  { route: 'me', label: '试穿记录' },
  { route: 'settings', label: '设置' },
];

const SOURCE_LABELS = {
  taobao: '淘宝 / 天猫',
  jd: '京东',
  pdd: '拼多多',
  douyin: '抖音商城',
};

function routeTitle(routeName) {
  switch (routeName) {
    case 'studio':
      return '试穿工作台';
    case 'tryon':
      return '单品试穿';
    case 'wardrobe':
      return '我的衣橱';
    case 'shop':
      return '示例橱窗';
    case 'me':
      return '试穿记录';
    case 'settings':
      return '设置';
    default:
      return '照花';
  }
}

function renderSidebarInner(state) {
  const activeRoute = state.route.name === 'tryon' ? 'studio' : state.route.name;
  const counts = {
    wardrobe: state.wardrobe.length,
    me: state.orders.length,
    shop: state.products.length,
  };
  return `
    <div>
      <a class="app-brand" href="#/home" aria-label="返回照花首页">
        <img src="/icon.svg?v=zhaohua-1" alt="" />
        <span>照花</span>
      </a>
      <nav class="app-nav" aria-label="主导航">
        <a class="app-nav__item" href="#/home"><span>首页画册</span></a>
        ${NAV_ITEMS.map(
          (item) => `
          <a
            class="app-nav__item${activeRoute === item.route ? ' is-active' : ''}"
            href="#/${item.route}"
            aria-current="${activeRoute === item.route ? 'page' : 'false'}"
          >
            <span>${esc(item.label)}</span>
            ${counts[item.route] != null ? `<span class="app-nav__count">${counts[item.route]}</span>` : ''}
          </a>
        `,
        ).join('')}
      </nav>
    </div>
    <div class="app-sidebar__foot">
      <div class="app-shell-badge">交互壳子 · 本地模拟状态</div>
    </div>
  `;
}

export function renderAppShell(state, bodyHtml, extraModalHtml = '') {
  const title = routeTitle(state.route.name);
  const topAction =
    state.route.name === 'studio'
      ? `<a class="btn btn--sm" href="#/wardrobe">去衣橱挑一套</a>`
      : `<a class="btn btn--sm btn--primary" href="#/studio">去试穿</a>`;

  const drawer = state.mobileNavOpen
    ? `
      <div class="drawer-backdrop" data-action="close-mobile-nav">
        <aside class="drawer" role="dialog" aria-label="导航菜单" data-stop-propagation="true">
          ${renderSidebarInner(state)}
        </aside>
      </div>
    `
    : '';

  return `
    <div class="app-frame" data-ui="framed-sheet">
      <aside class="app-sidebar" aria-label="侧边导航">
        ${renderSidebarInner(state)}
      </aside>
      <header class="app-topbar">
        <div class="app-topbar__left">
          <button type="button" class="app-menu-btn" data-action="toggle-mobile-nav" aria-label="打开菜单">菜单</button>
          <div class="app-crumb">
            <a href="#/home">照花</a>
            <span>/</span>
            <strong>${esc(title)}</strong>
          </div>
        </div>
        <div class="app-topbar__actions">
          ${topAction}
        </div>
      </header>
      <main id="main" class="app-sheet" tabindex="-1" data-view="${esc(state.route.name)}">
        ${bodyHtml}
      </main>
    </div>
    ${drawer}
    ${extraModalHtml}
    ${state.toastMessage ? `<div class="toast" role="status" aria-live="polite">${esc(state.toastMessage)}</div>` : ''}
  `;
}

/* =========================================================
   STUDIO VIEW (4-step workbench: person / pieces / shoot / result)
   ========================================================= */

export function renderStudioView(state) {
  const { studio, config, slots, slotByKey } = state;
  const pieces = selectedPiecesFromEntries(studio.entries);
  const issue = validateStudioDraft(studio.person, studio.entries);
  const isStudioMode = studio.mode === 'studio';
  const activePoses = studio.customPoses ?? recommendedPosesFor(pieces);
  const firstPose = config.posePresets.find((p) => p.id === activePoses[0]) || config.posePresets[0];
  const fullBatch = activePoses.length === 3;

  const steps = [
    { id: 'person', label: '选人物' },
    { id: 'pieces', label: `搭衣服 (${pieces.length})` },
    { id: 'shoot', label: '试拍设置' },
    { id: 'result', label: `试拍结果${studio.shoot.shots.length ? ` (${studio.shoot.shots.length})` : ''}` },
  ];

  // Right-side or left-side stage preview
  const shoot = studio.shoot;
  const currentShot = shoot.shots[shoot.index] || null;
  let stageHtml = '';
  if (studio.step === 'result' && currentShot) {
    const compareHtml =
      studio.resultTab === 'compare'
        ? `
        <div class="compare-grid">
          <div class="stage-canvas">
            <img src="${esc(shoot.original)}" alt="试穿前原图" />
            <span class="stage-canvas__badge">原图</span>
          </div>
          <div class="stage-canvas">
            <img src="${esc(currentShot.resultUrl)}" alt="试穿成片" />
            <span class="stage-canvas__badge">AI 成片 · ${esc(currentShot.poseLabel)}</span>
          </div>
        </div>
      `
        : `
        <div class="stage-canvas">
          <img src="${esc(studio.resultTab === 'original' ? shoot.original : currentShot.resultUrl)}" alt="试穿预览" />
          <span class="stage-canvas__badge">${
            studio.resultTab === 'original' ? '原图' : `AI 生成 · ${esc(currentShot.poseLabel)}`
          }</span>
        </div>
      `;

    stageHtml = `
      <section class="panel studio-stage" aria-label="本次试拍结果">
        <div class="panel__head">
          <h2 class="panel__title">本次试拍</h2>
          <div class="chips" role="tablist" aria-label="对比视图">
            ${[
              ['result', '成片'],
              ['original', '原图'],
              ['compare', '并排对比'],
            ]
              .map(
                ([tab, label]) => `
              <button
                type="button"
                role="tab"
                aria-selected="${studio.resultTab === tab ? 'true' : 'false'}"
                class="chip${studio.resultTab === tab ? ' is-active' : ''}"
                data-action="studio-result-tab"
                data-tab="${tab}"
              >${label}</button>
            `,
              )
              .join('')}
          </div>
        </div>
        ${compareHtml}
        ${
          shoot.shots.length > 1
            ? `
          <div class="shot-thumbs" role="list" aria-label="连拍成片切换">
            ${shoot.shots
              .map(
                (shot, idx) => `
              <button
                type="button"
                class="shot-thumb${idx === shoot.index ? ' is-active' : ''}"
                data-action="studio-select-shot"
                data-index="${idx}"
              >
                <img src="${esc(shot.resultUrl)}" alt="${esc(shot.poseLabel)}" />
                <span>${esc(shot.poseLabel)}</span>
              </button>
            `,
              )
              .join('')}
          </div>
        `
            : ''
        }
        <div class="ui-actions">
          <a class="btn btn--primary" href="${esc(currentShot.resultUrl)}" download="照花试穿-${esc(currentShot.poseId || 'result')}.png">下载成片（含 AI 标识）</a>
          <button type="button" class="btn" data-action="studio-step" data-step="shoot">返回修改参数</button>
          <a class="btn btn--ghost" href="#/me">在记录中查看</a>
        </div>
      </section>
    `;
  } else {
    stageHtml = `
      <section class="panel studio-stage" aria-label="当前人物与搭配预览">
        <div class="panel__head">
          <h2 class="panel__title">${shoot.busy ? '正在生成试穿成片…' : '试穿人物基准'}</h2>
          <span class="pill${studio.person.isDefault ? '' : ' pill--ok'}">${studio.person.isDefault ? '默认基准人物' : '已上传真人照'}</span>
        </div>
        <div class="stage-canvas">
          <img src="${esc(studio.person.image || DEFAULT_PERSON_URL)}" alt="试穿人物照片" />
          <span class="stage-canvas__badge">${pieces.length ? `已选 ${pieces.length} 件单品 · ${isStudioMode ? '无影棚模式' : '普通试穿'}` : '尚未选入单品'}</span>
        </div>
        ${
          pieces.length
            ? `
          <div class="chips" aria-label="已选单品摘要">
            ${pieces
              .map((piece) => `<span class="pill">${esc(slotByKey[piece.slot]?.label || piece.slot)} · ${esc(piece.source.name || piece.garmentType)}</span>`)
              .join('')}
          </div>
        `
            : `<p class="field__hint">在右侧依次确认人物、搭入单品，然后开始试拍。</p>`
        }
      </section>
    `;
  }

  // Step 1: Person panel
  const personPanel = `
    <section class="panel" aria-label="选人物">
      <div class="panel__head">
        <h2 class="panel__title">选人物</h2>
        <span class="field__hint">正面全身、光线均匀效果最稳</span>
      </div>
      <div class="person-row">
        <div class="person-thumb">
          <img src="${esc(studio.person.image || DEFAULT_PERSON_URL)}" alt="当前试穿人物" />
        </div>
        <div class="field">
          <p class="field__hint">当前使用：${studio.person.isDefault ? '照花默认基准人物（PoseWear 01）' : '本地上传真人全身照'}</p>
          <div class="ui-actions">
            <label class="btn btn--primary">
              上传我的全身照
              <input type="file" hidden accept="${ACCEPTED_IMAGES}" data-action="studio-person-file" />
            </label>
            <button type="button" class="btn" data-action="studio-person-preset" data-url="${esc(DEFAULT_PERSON_URL)}">恢复默认人物</button>
            <button type="button" class="btn btn--ghost" data-action="studio-person-preset" data-url="${esc(TURNAROUND_URL)}">查看三视图基准</button>
            <button type="button" class="btn btn--ghost" data-action="studio-person-preset" data-url="${esc(BASE_FACE_URL)}">查看面部基准</button>
          </div>
          ${studio.person.error ? `<p class="error-text">${esc(studio.person.error)}</p>` : ''}
        </div>
      </div>
      <div class="ui-actions" style="margin-top:16px">
        <button type="button" class="btn btn--primary" data-action="studio-step" data-step="pieces">下一步：搭衣服</button>
      </div>
    </section>
  `;

  // Step 2: Pieces panel
  const piecesPanel = `
    <section class="panel" aria-label="搭衣服">
      <div class="panel__head">
        <h2 class="panel__title">搭衣服（最多 ${MAX_PIECES} 件）</h2>
        <div class="ui-actions">
          <button type="button" class="btn btn--sm" data-action="studio-add-entry" ${studio.entries.length >= MAX_PIECES ? 'disabled' : ''}>新增一件</button>
          <a class="btn btn--sm btn--ghost" href="#/wardrobe">去衣橱挑一套</a>
        </div>
      </div>
      <div class="piece-list">
        ${studio.entries
          .map((entry, idx) => {
            const slotDef = slotByKey[entry.slot] || slots[0];
            const linkOpen = studio.openLinkEntryId === entry.id;
            const parsed = entry.parsedLink || null;
            return `
            <article class="piece-card">
              <div class="piece-card__top">
                <div class="piece-card__img">
                  ${entry.source ? `<img src="${esc(entry.source.imageUrl)}" alt="${esc(entry.source.name || '单品')}" />` : '<span>未选图</span>'}
                </div>
                <div>
                  <strong>${esc(entry.source?.name || `单品槽位 ${idx + 1}`)}</strong>
                  <p class="field__hint">${esc(slotDef.label)} · ${esc(entry.subtype || slotDef.subtypes[0] || '')} · ${esc(LAYER_LABELS[entry.layer] || '自动')}</p>
                  <div class="ui-actions" style="margin-top:8px">
                    <label class="btn btn--sm">
                      上传图片
                      <input type="file" hidden accept="${ACCEPTED_IMAGES}" data-action="studio-entry-file" data-entry-id="${esc(entry.id)}" />
                    </label>
                    <button type="button" class="btn btn--sm" data-action="studio-open-picker" data-entry-id="${esc(entry.id)}">从衣橱选</button>
                    <button type="button" class="btn btn--sm" data-action="studio-toggle-link" data-entry-id="${esc(entry.id)}">${linkOpen ? '收起链接' : '商品链接'}</button>
                  </div>
                </div>
                <button type="button" class="btn btn--sm btn--ghost" data-action="studio-remove-entry" data-entry-id="${esc(entry.id)}" ${studio.entries.length <= 1 ? 'disabled' : ''}>移除</button>
              </div>
              <div class="piece-card__controls">
                <label class="field">
                  <span class="field__label">类别</span>
                  <select class="select" data-action="studio-entry-slot" data-entry-id="${esc(entry.id)}">
                    ${slots.map((s) => `<option value="${esc(s.key)}"${s.key === entry.slot ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">细类</span>
                  <select class="select" data-action="studio-entry-subtype" data-entry-id="${esc(entry.id)}">
                    <option value="">默认（${esc(slotDef.subtypes[0] || slotDef.label)}）</option>
                    ${slotDef.subtypes.map((sub) => `<option value="${esc(sub)}"${sub === entry.subtype ? ' selected' : ''}>${esc(sub)}</option>`).join('')}
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">穿着层级</span>
                  <select class="select" data-action="studio-entry-layer" data-entry-id="${esc(entry.id)}">
                    ${Object.entries(LAYER_LABELS)
                      .map(([k, lbl]) => `<option value="${k}"${k === entry.layer ? ' selected' : ''}>${esc(lbl)}</option>`)
                      .join('')}
                  </select>
                </label>
              </div>
              ${
                linkOpen
                  ? `
                <div class="link-box">
                  <div class="link-box__row">
                    <input
                      type="text"
                      class="input"
                      placeholder="粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接"
                      value="${esc(entry.linkDraft || '')}"
                      data-action="studio-link-input"
                      data-entry-id="${esc(entry.id)}"
                    />
                    <button type="button" class="btn btn--primary" data-action="studio-parse-link" data-entry-id="${esc(entry.id)}">解析链接</button>
                  </div>
                  ${
                    parsed
                      ? `
                    <p class="field__hint">${esc(parsed.platformLabel)} · ${esc(parsed.title)}，点击一张商品图填入本槽位：</p>
                    <div class="mini-grid">
                      ${parsed.images
                        .map(
                          (img) => `
                        <button
                          type="button"
                          class="mini-pick"
                          data-action="studio-pick-link-image"
                          data-entry-id="${esc(entry.id)}"
                          data-url="${esc(img.url)}"
                          data-name="${esc(parsed.title)}"
                        >
                          <img src="${esc(img.url)}" alt="${esc(img.label)}" />
                          <span>${esc(img.label)}</span>
                        </button>
                      `,
                        )
                        .join('')}
                    </div>
                  `
                      : ''
                  }
                </div>
              `
                  : ''
              }
              ${entry.error ? `<p class="error-text">${esc(entry.error)}</p>` : ''}
            </article>
          `;
          })
          .join('')}
      </div>
      <div class="ui-actions" style="margin-top:16px; justify-content:space-between">
        <p class="${issue ? 'error-text' : 'field__hint'}" role="status">${esc(issue || `已就绪 ${pieces.length} 件单品，层级与类目无冲突。`)}</p>
        <div class="ui-actions">
          <button type="button" class="btn" data-action="studio-step" data-step="person">上一步</button>
          <button type="button" class="btn btn--primary" ${issue ? 'disabled' : ''} data-action="studio-step" data-step="shoot">下一步：试拍设置</button>
        </div>
      </div>
    </section>
  `;

  // Step 3: Shoot settings panel
  const shootPanel = `
    <section class="panel" aria-label="试拍设置">
      <div class="panel__head">
        <h2 class="panel__title">试拍设置</h2>
        <span class="pill">${esc(config.models.find((m) => m.id === state.settings.model)?.label || state.settings.model)}</span>
      </div>
      <div class="field" style="margin-bottom:16px">
        <span class="field__label">拍摄模式</span>
        <div class="seg-group">
          <button type="button" class="seg-btn${isStudioMode ? ' is-active' : ''}" data-action="studio-mode" data-mode="studio">
            <strong>无影棚三姿连拍</strong>
            <span>纯白 / 浅灰 / 暖白无缝棚，自选 3 个姿势一次出片</span>
          </button>
          <button type="button" class="seg-btn${!isStudioMode ? ' is-active' : ''}" data-action="studio-mode" data-mode="preserve">
            <strong>普通试穿</strong>
            <span>保留原图背景、光线与人物姿态，单张快速上身</span>
          </button>
        </div>
      </div>

      ${
        isStudioMode
          ? `
        <div class="field" style="margin-bottom:16px">
          <span class="field__label">无影棚背景</span>
          <div class="chips">
            ${config.studioPresets
              .map(
                (preset) => `
              <button
                type="button"
                class="chip${studio.background === preset.id ? ' is-active' : ''}"
                data-action="studio-background"
                data-bg="${esc(preset.id)}"
              >${esc(preset.label)}</button>
            `,
              )
              .join('')}
          </div>
          <p class="field__hint">${esc(config.studioPresets.find((p) => p.id === studio.background)?.hint || '')}</p>
        </div>

        <div class="field" style="margin-bottom:16px">
          <div class="panel__head" style="margin-bottom:6px">
            <span class="field__label">姿势选择（已选 ${activePoses.length} / 3）</span>
            <button type="button" class="btn btn--sm btn--ghost" data-action="studio-reset-poses">恢复推荐三姿</button>
          </div>
          <div class="pose-grid">
            ${config.posePresets
              .map((pose) => {
                const selected = activePoses.includes(pose.id);
                return `
                <button
                  type="button"
                  class="pose-card${selected ? ' is-active' : ''}"
                  data-action="studio-toggle-pose"
                  data-pose="${esc(pose.id)}"
                  aria-pressed="${selected ? 'true' : 'false'}"
                >
                  <img src="${esc(pose.referenceUrl)}" alt="${esc(pose.label)}" />
                  <span class="pose-card__title">${esc(pose.label)}</span>
                  <span class="pose-card__hint">${esc(pose.hint)}</span>
                </button>
              `;
              })
              .join('')}
          </div>
        </div>
      `
          : ''
      }

      <div class="field" style="margin-bottom:16px">
        <span class="field__label">版型松紧</span>
        <div class="chips">
          ${config.fits
            .map(
              (fit) => `
            <button
              type="button"
              class="chip${studio.fit === fit.id ? ' is-active' : ''}"
              data-action="studio-fit"
              data-fit="${esc(fit.id)}"
            >${esc(fit.label)}</button>
          `,
            )
            .join('')}
        </div>
      </div>

      <label class="field" style="margin-bottom:16px">
        <span class="field__label">补充说明（可选）</span>
        <textarea
          class="textarea"
          placeholder="例如：衬衫下摆塞进高腰裙里，袖口自然卷起一折"
          data-action="studio-prompt"
        >${esc(studio.prompt)}</textarea>
      </label>

      ${issue ? `<p class="error-text" style="margin-bottom:12px">${esc(issue)}</p>` : ''}
      <div class="ui-actions">
        <button
          type="button"
          class="btn btn--primary"
          data-action="studio-submit"
          data-trial="false"
          ${studio.shoot.busy || Boolean(issue) || (isStudioMode && !fullBatch) ? 'disabled' : ''}
        >${studio.shoot.busy ? '试拍生成中…' : isStudioMode ? '开始三姿连拍' : '开始普通试穿'}</button>
        ${
          isStudioMode
            ? `
          <button
            type="button"
            class="btn"
            data-action="studio-submit"
            data-trial="true"
            ${studio.shoot.busy || Boolean(issue) || !firstPose ? 'disabled' : ''}
          >先试拍第一姿（${esc(firstPose?.label || '')}）</button>
        `
            : ''
        }
        <button type="button" class="btn btn--ghost" data-action="studio-step" data-step="pieces">返回改衣服</button>
      </div>
    </section>
  `;

  // Step 4: Result summary panel on right
  const resultInfoPanel = `
    <section class="panel" aria-label="本次试拍详情">
      <div class="panel__head">
        <h2 class="panel__title">成片信息</h2>
        <span class="pill pill--ok">已完成（前端壳子模拟）</span>
      </div>
      <p class="field__hint">拍摄模式：${isStudioMode ? '无影棚连拍' : '普通试穿'} · 背景：${esc(
        config.studioPresets.find((p) => p.id === studio.background)?.label || '原图',
      )} · 版型：${esc(config.fits.find((f) => f.id === studio.fit)?.label || '合身')}</p>
      <p class="field__hint" style="margin-top:8px">成片已同步写入「试穿记录」列表，可切换至记录页检索或复拍。</p>
      <div class="ui-actions" style="margin-top:16px">
        <button type="button" class="btn btn--primary" data-action="studio-step" data-step="shoot">调整姿势再拍一次</button>
        <button type="button" class="btn" data-action="studio-step" data-step="pieces">换一套衣服</button>
      </div>
    </section>
  `;

  const activeStepPanel =
    studio.step === 'person'
      ? personPanel
      : studio.step === 'pieces'
        ? piecesPanel
        : studio.step === 'shoot'
          ? shootPanel
          : resultInfoPanel;

  const pickerModal = studio.pickerEntryId
    ? `
      <div class="modal-backdrop" data-action="studio-close-picker">
        <div class="modal" role="dialog" aria-label="从衣橱选择单品" data-stop-propagation="true">
          <div class="modal__head">
            <h2 class="modal__title">从衣橱选单品</h2>
            <button type="button" class="btn btn--sm" data-action="studio-close-picker">关闭</button>
          </div>
          <div class="closet-grid">
            ${state.wardrobe
              .map(
                (item) => `
              <button
                type="button"
                class="product-card"
                data-action="studio-pick-wardrobe-item"
                data-entry-id="${esc(studio.pickerEntryId)}"
                data-item-id="${esc(item.id)}"
              >
                <div class="product-card__media">
                  <img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" />
                </div>
                <div class="product-card__body">
                  <strong>${esc(item.name)}</strong>
                  <span class="field__hint">${esc(slotByKey[item.category]?.label || item.category)} · ${esc(item.subtype)}</span>
                </div>
              </button>
            `,
              )
              .join('')}
          </div>
        </div>
      </div>
    `
    : '';

  const html = `
    <header class="ui-head">
      <div>
        <h1 class="ui-title">试穿工作台</h1>
        <p class="ui-sub">选人物、搭单品、设棚拍参数并对比成片。</p>
      </div>
      <div class="ui-actions">
        <a class="btn btn--sm" href="#/shop">从橱窗挑单品</a>
        <a class="btn btn--sm" href="#/me">查看历史记录</a>
      </div>
    </header>

    <div class="tabs" role="tablist" aria-label="试穿步骤">
      ${steps
        .map(
          (st) => `
        <button
          type="button"
          role="tab"
          aria-selected="${studio.step === st.id ? 'true' : 'false'}"
          class="tab${studio.step === st.id ? ' is-active' : ''}"
          data-action="studio-step"
          data-step="${st.id}"
        >${esc(st.label)}</button>
      `,
        )
        .join('')}
    </div>

    <div class="studio-layout">
      <div>${stageHtml}</div>
      <div>${activeStepPanel}</div>
    </div>
  `;

  return { html, modal: pickerModal };
}

/* =========================================================
   WARDROBE VIEW (Closet + AI Stylist + Upload / Edit / Link Import)
   ========================================================= */

export function renderWardrobeView(state) {
  const { wardrobe, wardrobeSelection, wardrobeQuery, wardrobeCategory, slots, slotByKey, stylist } = state;
  const needle = wardrobeQuery.trim().toLowerCase();
  const filtered = wardrobe.filter((item) => {
    if (wardrobeCategory && item.category !== wardrobeCategory) return false;
    if (!needle) return true;
    return [item.name, item.subtype, ...(item.tags || [])].join(' ').toLowerCase().includes(needle);
  });

  const byId = new Map(wardrobe.map((item) => [item.id, item]));
  const selectedItems = wardrobeSelection.map((id) => byId.get(id)).filter(Boolean);

  const suggestion = stylist.suggestion;
  const suggestionItems = suggestion ? Object.values(suggestion.slots).flat() : [];

  const dialog = state.wardrobeDialog;
  let modalHtml = '';
  if (dialog?.type === 'edit' || dialog?.type === 'create') {
    const form = dialog.form;
    const slotDef = slotByKey[form.category] || slots[0];
    modalHtml = `
      <div class="modal-backdrop" data-action="wardrobe-close-dialog">
        <div class="modal" role="dialog" aria-label="${dialog.type === 'create' ? '上传单品' : '编辑单品'}" data-stop-propagation="true">
          <div class="modal__head">
            <h2 class="modal__title">${dialog.type === 'create' ? '上传单品到衣橱' : '编辑单品信息'}</h2>
            <button type="button" class="btn btn--sm" data-action="wardrobe-close-dialog">关闭</button>
          </div>
          <form id="wardrobe-item-form" class="field" style="gap:12px">
            <div class="person-row">
              <div class="person-thumb">
                <img src="${esc(form.imageUrl || '/catalog/blouse-linen.jpg')}" alt="单品预览" />
              </div>
              <div class="field">
                <label class="btn btn--sm">
                  选择本地图片
                  <input type="file" hidden accept="${ACCEPTED_IMAGES}" data-action="wardrobe-dialog-file" />
                </label>
                <p class="field__hint">支持 PNG / JPEG / WebP，未选本地文件时沿用当前预览图。</p>
              </div>
            </div>
            <label class="field">
              <span class="field__label">单品名称</span>
              <input class="input" name="name" required value="${esc(form.name)}" placeholder="例如：米白色高腰阔腿裤" />
            </label>
            <div class="piece-card__controls">
              <label class="field">
                <span class="field__label">分类</span>
                <select class="select" name="category" data-action="wardrobe-dialog-category">
                  ${slots.map((s) => `<option value="${esc(s.key)}"${s.key === form.category ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                </select>
              </label>
              <label class="field">
                <span class="field__label">细类</span>
                <select class="select" name="subtype">
                  ${slotDef.subtypes.map((sub) => `<option value="${esc(sub)}"${sub === form.subtype ? ' selected' : ''}>${esc(sub)}</option>`).join('')}
                </select>
              </label>
              <label class="field">
                <span class="field__label">默认层级</span>
                <select class="select" name="layer">
                  ${Object.entries(LAYER_LABELS)
                    .map(([k, lbl]) => `<option value="${k}"${k === form.layer ? ' selected' : ''}>${esc(lbl)}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
            <label class="field">
              <span class="field__label">标签（用空格或逗号分隔）</span>
              <input class="input" name="tags" value="${esc((form.tags || []).join(' '))}" placeholder="通勤 亚麻 春秋" />
            </label>
            <div class="ui-actions" style="justify-content:flex-end">
              <button type="button" class="btn" data-action="wardrobe-close-dialog">取消</button>
              <button type="submit" class="btn btn--primary">保存单品</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } else if (dialog?.type === 'import') {
    const parsed = dialog.parsed;
    modalHtml = `
      <div class="modal-backdrop" data-action="wardrobe-close-dialog">
        <div class="modal" role="dialog" aria-label="从商品链接导入单品" data-stop-propagation="true">
          <div class="modal__head">
            <h2 class="modal__title">从商品链接导入单品</h2>
            <button type="button" class="btn btn--sm" data-action="wardrobe-close-dialog">关闭</button>
          </div>
          <div class="link-box__row">
            <input
              type="text"
              class="input"
              placeholder="粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接"
              value="${esc(dialog.url || '')}"
              data-action="wardrobe-import-input"
            />
            <button type="button" class="btn btn--primary" data-action="wardrobe-import-parse">解析主图</button>
          </div>
          ${
            parsed
              ? `
            <p class="field__hint">${esc(parsed.platformLabel)} · ${esc(parsed.title)}，点击主图加入衣橱：</p>
            <div class="mini-grid">
              ${parsed.images
                .map(
                  (img) => `
                <button
                  type="button"
                  class="mini-pick"
                  data-action="wardrobe-import-add"
                  data-url="${esc(img.url)}"
                  data-name="${esc(parsed.title)}"
                >
                  <img src="${esc(img.url)}" alt="${esc(img.label)}" />
                  <span>${esc(img.label)}</span>
                </button>
              `,
                )
                .join('')}
            </div>
          `
              : `<p class="field__hint">演示模式下输入任意商品链接或关键词，即可模拟解析商品主图并一键收藏进衣橱。</p>`
          }
        </div>
      </div>
    `;
  }

  const html = `
    <header class="ui-head">
      <div>
        <h1 class="ui-title">我的衣橱</h1>
        <p class="ui-sub">收藏单品、获取 AI 今日穿搭，并直接带去试穿工作台。</p>
      </div>
      <div class="ui-actions">
        <button type="button" class="btn" data-action="wardrobe-open-import">商品链接导入</button>
        <button type="button" class="btn btn--primary" data-action="wardrobe-open-create">上传单品</button>
      </div>
    </header>

    <section class="panel panel--tint" style="margin-bottom:20px" aria-labelledby="stylist-title">
      <div class="panel__head">
        <div>
          <h2 id="stylist-title" class="panel__title">AI 今日穿搭</h2>
          <p class="field__hint">说出今天要去哪、天气或想穿的风格，从你的衣橱里挑一套。</p>
        </div>
        <span class="pill">${wardrobe.length} 件可用单品</span>
      </div>
      <form id="stylist-form" class="link-box__row">
        <input
          type="text"
          class="input"
          name="request"
          maxlength="200"
          value="${esc(stylist.request)}"
          placeholder="例如：明天面试，想穿得正式一点又不显老"
          aria-label="今日穿搭需求"
        />
        <button type="submit" class="btn btn--primary" ${stylist.busy ? 'disabled' : ''}>${stylist.busy ? '正在挑选…' : '帮我选一套'}</button>
      </form>
      ${
        suggestion
          ? `
        <div class="panel" style="margin-top:12px">
          <p style="margin:0 0 10px; font-size:14px">${esc(suggestion.reason)}</p>
          <div class="chips" style="margin-bottom:12px">
            ${suggestionItems
              .map((item) => `<span class="pill pill--ok">${esc(slotByKey[item.category]?.label || item.category)} · ${esc(item.name)}</span>`)
              .join('')}
            ${suggestion.missing.map((m) => `<span class="pill pill--warn">建议补充：${esc(slotByKey[m]?.label || m)}</span>`).join('')}
          </div>
          <div class="ui-actions">
            <button type="button" class="btn btn--primary btn--sm" data-action="stylist-send-studio" data-mode="studio">带这套进无影棚</button>
            <button type="button" class="btn btn--sm" data-action="stylist-send-studio" data-mode="preserve">普通试穿</button>
            <button type="button" class="btn btn--sm btn--ghost" data-action="stylist-quick-shoot" ${stylist.shootBusy ? 'disabled' : ''}>${stylist.shootBusy ? '正在出图…' : '直接生成试穿预览'}</button>
          </div>
          ${
            stylist.shootResult
              ? `<p class="field__hint" style="margin-top:10px">已生成快速试穿成片并同步到「试穿记录」：<a href="#/me" style="text-decoration:underline">打开查看</a></p>`
              : ''
          }
        </div>
      `
          : ''
      }
    </section>

    <div class="wardrobe-layout">
      <div>
        <div class="toolbar">
          <input
            type="search"
            class="input toolbar__search"
            placeholder="搜索单品名称、细类或标签"
            aria-label="搜索衣橱单品"
            value="${esc(wardrobeQuery)}"
            data-action="wardrobe-search"
          />
          <div class="chips" role="group" aria-label="衣橱分类筛选">
            <button type="button" class="chip${wardrobeCategory === '' ? ' is-active' : ''}" data-action="wardrobe-category" data-category="">全部 (${wardrobe.length})</button>
            ${slots
              .map((slot) => {
                const count = wardrobe.filter((i) => i.category === slot.key).length;
                if (!count) return '';
                return `<button type="button" class="chip${wardrobeCategory === slot.key ? ' is-active' : ''}" data-action="wardrobe-category" data-category="${esc(slot.key)}">${esc(slot.label)} (${count})</button>`;
              })
              .join('')}
          </div>
        </div>

        ${
          filtered.length
            ? `
          <div class="closet-grid">
            ${filtered
              .map((item) => {
                const picked = wardrobeSelection.includes(item.id);
                return `
                <article class="garment-card${picked ? ' is-selected' : ''}">
                  <div class="garment-card__media">
                    <img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" />
                  </div>
                  <div class="garment-card__body">
                    <div class="garment-card__name">${esc(item.name)}</div>
                    <div class="garment-card__meta">${esc(slotByKey[item.category]?.label || item.category)} · ${esc(item.subtype)}</div>
                    <div class="garment-card__meta">${esc((item.tags || []).slice(0, 3).join(' · '))}</div>
                    <div class="garment-card__foot">
                      <button
                        type="button"
                        class="btn btn--sm${picked ? ' btn--primary' : ''}"
                        data-action="wardrobe-toggle-select"
                        data-item-id="${esc(item.id)}"
                      >${picked ? '已选入搭配' : '选入搭配'}</button>
                      <div class="ui-actions" style="gap:4px">
                        <button type="button" class="btn btn--sm btn--ghost" data-action="wardrobe-open-edit" data-item-id="${esc(item.id)}">编辑</button>
                        <button type="button" class="btn btn--sm btn--ghost" data-action="wardrobe-delete-item" data-item-id="${esc(item.id)}">删除</button>
                      </div>
                    </div>
                  </div>
                </article>
              `;
              })
              .join('')}
          </div>
        `
            : `<div class="panel"><p class="panel__title">没有匹配的单品</p><p class="field__hint">换个关键词，或者直接上传一件新单品。</p></div>`
        }
      </div>

      <aside class="panel" aria-labelledby="wardrobe-picks-title">
        <div class="panel__head">
          <h2 id="wardrobe-picks-title" class="panel__title">当前搭配</h2>
          <span class="pill">${selectedItems.length} 件</span>
        </div>
        ${
          selectedItems.length
            ? `
          <div class="piece-list" style="margin-bottom:14px">
            ${selectedItems
              .map(
                (item) => `
              <div class="source-row">
                <div class="source-row__left">
                  <img src="${esc(item.imageUrl)}" alt="" style="width:40px;height:48px;object-fit:cover;border-radius:6px" />
                  <div>
                    <div style="font-size:13px;font-weight:500">${esc(item.name)}</div>
                    <div class="field__hint">${esc(slotByKey[item.category]?.label || item.category)}</div>
                  </div>
                </div>
                <button type="button" class="btn btn--sm btn--ghost" data-action="wardrobe-toggle-select" data-item-id="${esc(item.id)}">移除</button>
              </div>
            `,
              )
              .join('')}
          </div>
        `
            : `<p class="field__hint" style="margin-bottom:14px">在左侧勾选 1–5 件单品组成一套，带进试穿工作台。</p>`
        }
        <button
          type="button"
          class="btn btn--primary btn--block"
          data-action="wardrobe-send-studio"
          ${selectedItems.length ? '' : 'disabled'}
        >去试穿这一套</button>
      </aside>
    </div>
  `;

  return { html, modal: modalHtml };
}

/* =========================================================
   CATALOG VIEW (Shop)
   ========================================================= */

export function renderCatalogView(state) {
  const { products, config, catalogQuery, catalogCategory } = state;
  const needle = catalogQuery.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (catalogCategory && p.category !== catalogCategory) return false;
    if (!needle) return true;
    return [p.name, p.subtitle, ...(p.tags || [])].join(' ').toLowerCase().includes(needle);
  });

  const html = `
    <header class="ui-head">
      <div>
        <h1 class="ui-title">示例橱窗</h1>
        <p class="ui-sub">挑一件喜欢的单品，直接带入试穿工作台看上身效果。</p>
      </div>
      <div class="ui-actions">
        <a class="btn" href="#/wardrobe">从商品链接导入更多</a>
      </div>
    </header>

    <div class="toolbar">
      <input
        type="search"
        class="input toolbar__search"
        placeholder="搜索商品名称或标签"
        aria-label="搜索商品"
        value="${esc(catalogQuery)}"
        data-action="catalog-search"
      />
      <div class="chips" role="group" aria-label="商品分类">
        <button type="button" class="chip${catalogCategory === '' ? ' is-active' : ''}" data-action="catalog-category" data-category="">全部</button>
        ${config.categories
          .map(
            (cat) => `
          <button type="button" class="chip${catalogCategory === cat.id ? ' is-active' : ''}" data-action="catalog-category" data-category="${esc(cat.id)}">${esc(cat.label)}</button>
        `,
          )
          .join('')}
      </div>
    </div>

    ${
      filtered.length
        ? `
      <div class="catalog-grid">
        ${filtered
          .map(
            (product) => `
          <button
            type="button"
            class="product-card"
            data-action="catalog-tryon"
            data-product-id="${esc(product.id)}"
            aria-label="${esc(product.name)}，进入单品试穿"
          >
            <div class="product-card__media">
              <img src="${esc(product.image)}" alt="${esc(product.name)}" />
            </div>
            <div class="product-card__body">
              <strong>${esc(product.name)}</strong>
              <span class="field__hint">${esc(product.subtitle)}</span>
              <div class="chips" style="margin-top:6px">
                ${(product.tags || []).slice(0, 3).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
              </div>
            </div>
          </button>
        `,
          )
          .join('')}
      </div>
    `
        : `<div class="panel"><p class="panel__title">没有符合条件的商品</p><p class="field__hint">换个关键词或分类，也可以在衣橱里粘贴商品链接。</p></div>`
    }
  `;

  return { html, modal: '' };
}

/* =========================================================
   RECORDS VIEW (Try-on History)
   ========================================================= */

function statusPill(status) {
  if (status === 'success') return '<span class="pill pill--ok">已完成</span>';
  if (status === 'pending') return '<span class="pill pill--warn">生成中</span>';
  return '<span class="pill pill--err">失败</span>';
}

export function renderRecordsView(state) {
  const { orders, selectedOrderId, recordsFilter, slotByKey } = state;
  const filtered = orders.filter((o) => (recordsFilter === 'all' ? true : o.status === recordsFilter));
  const selected = filtered.find((o) => o.id === selectedOrderId) || filtered[0] || null;

  const html = `
    <header class="ui-head">
      <div>
        <h1 class="ui-title">试穿记录</h1>
        <p class="ui-sub">查看试穿进度，打开、下载已完成的成片或重新试拍。</p>
      </div>
      <div class="ui-actions">
        <button type="button" class="btn btn--sm" data-action="records-refresh">刷新状态</button>
        <a class="btn btn--sm btn--primary" href="#/studio">去搭新一套</a>
      </div>
    </header>

    <div class="tabs" role="tablist" aria-label="记录状态筛选">
      ${[
        ['all', `全部 (${orders.length})`],
        ['success', `已完成 (${orders.filter((o) => o.status === 'success').length})`],
        ['pending', `生成中 (${orders.filter((o) => o.status === 'pending').length})`],
        ['failed', `失败 (${orders.filter((o) => o.status === 'failed').length})`],
      ]
        .map(
          ([key, label]) => `
        <button
          type="button"
          role="tab"
          aria-selected="${recordsFilter === key ? 'true' : 'false'}"
          class="tab${recordsFilter === key ? ' is-active' : ''}"
          data-action="records-filter"
          data-filter="${key}"
        >${label}</button>
      `,
        )
        .join('')}
    </div>

    <div class="records-layout">
      <section class="panel" aria-label="最近的试穿">
        ${
          filtered.length
            ? `
          <table class="records-table">
            <thead>
              <tr>
                <th>搭配内容</th>
                <th>模式与姿势</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((order) => {
                  const slotText = (order.slots || []).map((s) => slotByKey[s]?.label || s).join(' · ') || '组合搭配';
                  return `
                  <tr
                    class="${selected && order.id === selected.id ? 'is-active' : ''}"
                    data-action="records-select"
                    data-order-id="${esc(order.id)}"
                  >
                    <td>
                      <strong>${esc(order.productName)}</strong>
                      <div class="field__hint">${esc(slotText)}</div>
                    </td>
                    <td>${order.mode === 'studio' ? '无影棚' : '普通试穿'} · ${esc(order.poseLabel || '默认')}</td>
                    <td>${statusPill(order.status)}</td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        `
            : `<p class="field__hint">当前筛选下还没有试穿记录。</p>`
        }
      </section>

      <aside class="panel" aria-label="记录详情">
        ${
          selected
            ? `
          <div class="panel__head">
            <h2 class="panel__title">${esc(selected.productName)}</h2>
            ${statusPill(selected.status)}
          </div>
          ${
            selected.status === 'success' && selected.resultUrl
              ? `
            <div class="stage-canvas" style="margin-bottom:14px">
              <img src="${esc(selected.resultUrl)}" alt="试穿结果" />
              <span class="stage-canvas__badge">AI 生成 · ${esc(selected.poseLabel || '成片')}</span>
            </div>
            <p class="field__hint" style="margin-bottom:14px">${esc(selected.note || '')} · 模型：${esc(selected.model || '')}</p>
            <div class="ui-actions">
              <a class="btn btn--primary" href="${esc(selected.resultUrl)}" download="照花-${esc(selected.id)}.png">下载效果图（含 AI 标识）</a>
              <button type="button" class="btn" data-action="records-retry">回到工作台复拍</button>
            </div>
          `
              : selected.status === 'pending'
                ? `
            <p class="field__hint" style="margin-bottom:14px">${esc(selected.note || '正在生成成片，请点击刷新查看进度。')}</p>
            <button type="button" class="btn btn--primary" data-action="records-refresh">模拟完成生成</button>
          `
                : `
            <p class="error-text" style="margin-bottom:14px">${esc(selected.errorMessage || '本次试穿生成失败。')}</p>
            <button type="button" class="btn btn--primary" data-action="records-retry">返回工作台再试一次</button>
          `
          }
        `
            : `<p class="field__hint">选择左侧一条记录以查看详情。</p>`
        }
      </aside>
    </div>
  `;

  return { html, modal: '' };
}

/* =========================================================
   SETTINGS VIEW (Two-column Taste Settings)
   ========================================================= */

export function renderSettingsView(state) {
  const { settings, config } = state;
  const html = `
    <header class="ui-head">
      <div>
        <h1 class="ui-title">设置</h1>
        <p class="ui-sub">管理试穿图像模型、图片服务状态和电商商品来源登录。</p>
      </div>
    </header>

    <div class="settings-stack">
      <section class="settings-row">
        <div>
          <h2 class="settings-row__title">图像模型</h2>
          <p class="settings-row__desc">普通试穿和无影棚三姿连拍共用同一生成模型，切换后立即对下一次试拍生效。</p>
        </div>
        <div class="settings-panel">
          <label class="field">
            <span class="field__label">用于下一次试穿</span>
            <select class="select" aria-label="图像模型" data-action="settings-model">
              ${config.models
                .map((m) => `<option value="${esc(m.id)}"${m.id === settings.model ? ' selected' : ''}>${esc(m.label)}</option>`)
                .join('')}
            </select>
          </label>
        </div>
      </section>

      <section class="settings-row">
        <div>
          <h2 class="settings-row__title">图片服务</h2>
          <p class="settings-row__desc">生成试穿图需要连接后端图片网关；当前为纯前端交互壳子，未发真实网络请求。</p>
        </div>
        <div class="settings-panel">
          <div class="source-row">
            <span>连通状态</span>
            <span class="pill pill--ok">${esc(config.gateway.label)}</span>
          </div>
          <p class="field__hint">接入后端时仅需替换 <code>shell-state.js</code> 中的模拟动作，页面结构与交互流无需改动。</p>
        </div>
      </section>

      <section class="settings-row">
        <div>
          <h2 class="settings-row__title">商品来源</h2>
          <p class="settings-row__desc">部分电商平台需要先扫码登录，才能稳定读取商品高清主图。</p>
        </div>
        <div class="settings-panel">
          ${Object.entries(SOURCE_LABELS)
            .map(([platform, label]) => {
              const logged = Boolean(settings.sources[platform]);
              const phase = settings.loginState[platform] || 'idle';
              return `
              <div class="source-row">
                <div class="source-row__left">
                  <strong>${esc(label)}</strong>
                  <span class="pill${logged ? ' pill--ok' : ''}">${logged ? '已登录' : phase === 'scanning' ? '扫码中…' : '未登录'}</span>
                </div>
                <div class="ui-actions">
                  ${
                    logged
                      ? `<button type="button" class="btn btn--sm btn--ghost" data-action="settings-source-logout" data-platform="${platform}">退出登录</button>`
                      : `<button type="button" class="btn btn--sm" data-action="settings-source-login" data-platform="${platform}" ${phase === 'scanning' ? 'disabled' : ''}>${phase === 'scanning' ? '等待确认…' : '扫码登录'}</button>`
                  }
                </div>
              </div>
            `;
            })
            .join('')}
        </div>
      </section>
    </div>
  `;

  return { html, modal: '' };
}
