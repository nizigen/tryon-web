function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SLOT_ROWS = [
  { slot: 'top', label: '上衣', note: '衬衫 / 针织 / T 恤' },
  { slot: 'bottom', label: '下装', note: '半身裙 / 长裤' },
  { slot: 'dress', label: '连衣裙', note: '与上下装互斥' },
  { slot: 'hosiery', label: '袜品', note: '丝袜 / 打底裤' },
];

const STILLS = [
  {
    src: '/taste-shell/assets/flatlay-shirt.jpg',
    alt: '白色亚麻衬衫与灰色长裤平铺在浅色木桌上',
    title: '台照 · 亚麻衬衫与长裤',
    note: '平铺成对拍摄，肩线与裤长可直接量，避免只看挂拍判断比例。',
    span: 'wide',
  },
  {
    src: '/taste-shell/assets/tights-macro.jpg',
    alt: '黑色丝袜在小腿与脚踝处的特写',
    title: '细节 · 20D 黑丝',
    note: '连裤袜的密度决定成片里腿部的反光强度，棚拍前先在自然光下看一眼。',
    span: 'tall',
  },
  {
    src: '/taste-shell/assets/knit-macro.jpg',
    alt: '米白麻花针织毛衣的纱线特写',
    title: '材质 · 麻花针织',
    note: '纱线粗细与麻花间距会改变上身廓形，宽松版型需要更长针距才不显臃肿。',
    span: 'small',
  },
  {
    src: '/taste-shell/assets/silk-drape.jpg',
    alt: '黑色缎面布料在石膏台面上垂落',
    title: '垂坠 · 缎面裙摆',
    note: '缎面的落点决定裙摆弧线，所以试穿预览要给到完整的下摆而不是裁掉。',
    span: 'small',
  },
];

const STEPS = [
  {
    verb: '选人',
    body: '用照花的基准人物，或上传一张正面全身照。身形、肤色与妆面锁定之后，每次换衣服都只换衣服。',
    src: '/taste-shell/assets/arch-room.jpg',
    alt: '带拱门的空置镜室，纱帘与木地板',
  },
  {
    verb: '配衣',
    body: '衣橱单品、商品主图或商品链接都能进槽位，七类槽位自带层级与互斥校验，冲突在拍摄前就说清。',
    src: '/taste-shell/assets/linen-fold.jpg',
    alt: '木凳上叠好的亚麻衬衫、针织与缎面裙',
  },
  {
    verb: '出片',
    body: '普通试穿保留原图光线，无影棚模式可选三种无缝背景，并按 PoseWear 参考一次连拍三个姿势。',
    src: '/taste-shell/assets/flatlay-skirt.jpg',
    alt: '灰色百褶中长裙与黑色皮带平铺在木桌上',
  },
];

const FACTS = [
  ['7 类槽位', '上衣到下装、连衣裙、袜品、外套、鞋履与配饰'],
  ['6 个姿势', 'PoseWear 参考姿势，一次连拍三姿'],
  ['3 种无缝棚', '纯白 / 浅灰 / 暖白，决定成片底色'],
  ['2 种拍摄', '普通试穿保留原光线，棚拍重打光'],
];

function composeEntries(state) {
  const byId = new Map(state.wardrobe.map((item) => [item.id, item]));
  const picked = [];
  for (const row of SLOT_ROWS) {
    const id = state.composer?.[row.slot];
    const item = id ? byId.get(id) : null;
    if (item) picked.push({ row, item });
  }
  return picked;
}

function slotIsBlocked(row, hasDress, hasTopOrBottom) {
  if (row.slot === 'hosiery') return false;
  if (row.slot === 'dress') return hasTopOrBottom;
  return hasDress;
}

function renderChip(item, row, active, disabled) {
  return `
    <button
      type="button"
      class="mn-chip${active ? ' is-active' : ''}"
      data-action="compose-set"
      data-slot="${esc(row.slot)}"
      data-item-id="${esc(item.id)}"
      aria-pressed="${active ? 'true' : 'false'}"
      ${disabled ? 'disabled' : ''}
    >
      <img src="${esc(item.imageUrl)}" alt="" />
      <span>${esc(item.name)}</span>
    </button>
  `;
}

function renderSlotRow(state, row, hasDress, hasTopOrBottom) {
  const candidates = state.wardrobe.filter((item) => item.category === row.slot);
  const disabled = slotIsBlocked(row, hasDress, hasTopOrBottom);
  const options = candidates.length
    ? candidates
        .map((item) => renderChip(item, row, state.composer?.[row.slot] === item.id, disabled))
        .join('')
    : `<p class="mn-slot__empty">衣橱里还没有${esc(row.label)}，<a href="#/wardrobe">上传一件</a>。</p>`;

  return `
    <div class="mn-slot${disabled ? ' is-muted' : ''}">
      <div class="mn-slot__label">
        <span>${esc(row.label)}</span>
        <span class="mn-slot__note">${esc(row.note)}</span>
      </div>
      <div class="mn-slot__options">${options}</div>
    </div>
  `;
}

function renderComposer(state) {
  const selected = composeEntries(state);
  const hasDress = Boolean(state.composer?.dress);
  const hasTopOrBottom = Boolean(state.composer?.top || state.composer?.bottom);
  const conflict = hasDress && hasTopOrBottom;

  const rows = SLOT_ROWS.map((row) => renderSlotRow(state, row, hasDress, hasTopOrBottom)).join('');

  const summary = selected.length
    ? selected.map(({ item }) => item.name).join(' ＋ ')
    : '还没有选入单品';

  let hint = '选一两件，算式会实时告诉你缺什么。';
  if (conflict) {
    hint = '连衣裙与上衣、下装互斥，先清掉一边再看。';
  } else if (selected.length) {
    hint = `${selected.length} 件单品，层级无冲突，可以直接进无影棚。`;
  }

  return `
    <div class="mn-composer" aria-label="穿搭算式">
      ${rows}
      <div class="mn-composer__foot">
        <div>
          <p class="mn-composer__line" role="status">${esc(summary)}</p>
          <p class="mn-composer__hint">${esc(hint)}</p>
        </div>
        <div class="mn-composer__actions">
          <button type="button" class="mn-btn mn-btn--text" data-action="compose-clear" ${selected.length ? '' : 'disabled'}>清空</button>
          <button type="button" class="mn-btn mn-btn--solid" data-action="compose-to-studio" ${selected.length && !conflict ? '' : 'disabled'}>带这套进无影棚</button>
        </div>
      </div>
    </div>
  `;
}

export function renderHomeView(state) {
  const stillCards = STILLS.map(
    (still) => `
    <figure class="mn-still mn-still--${esc(still.span)}">
      <img src="${esc(still.src)}" alt="${esc(still.alt)}" loading="lazy" />
      <figcaption>
        <span class="mn-still__title">${esc(still.title)}</span>
        <span class="mn-still__note">${esc(still.note)}</span>
      </figcaption>
    </figure>
  `,
  ).join('');

  const stepCards = STEPS.map(
    (step) => `
    <article class="mn-step">
      <img class="mn-step__img" src="${esc(step.src)}" alt="${esc(step.alt)}" loading="lazy" />
      <h3 class="mn-step__verb">${esc(step.verb)}</h3>
      <p class="mn-step__body">${esc(step.body)}</p>
    </article>
  `,
  ).join('');

  const factRows = FACTS.map(
    ([value, note]) => `
    <div class="mn-fact">
      <span class="mn-fact__value">${esc(value)}</span>
      <span class="mn-fact__note">${esc(note)}</span>
    </div>
  `,
  ).join('');

  return `
    <div class="mn-page">
      <header class="mn-masthead">
        <a class="mn-wordmark" href="#/home" aria-label="照花首页">
          <img src="/icon.svg?v=zhaohua-1" alt="" />
          <span>照花</span>
        </a>
        <nav class="mn-nav" aria-label="主导航">
          <a href="#/studio">工作台</a>
          <a href="#/wardrobe">衣橱</a>
          <a href="#/shop">橱窗</a>
          <a href="#/me">记录</a>
          <a href="#/settings">设置</a>
        </nav>
      </header>

      <main id="main" tabindex="-1">
        <section class="mn-hero" aria-labelledby="home-title">
          <div class="mn-hero__text">
            <h1 id="home-title" class="mn-hero__title">穿之前，<br />先在镜室<br />走一遍。</h1>
            <p class="mn-hero__lead">照花把衣橱、商品台照与无影棚放进同一间房：先算清槽位，再看上身比例，最后按姿势连拍成片。</p>
            <div class="mn-hero__actions">
              <a class="mn-btn mn-btn--solid" href="#/studio">进试穿工作台</a>
              <a class="mn-btn mn-btn--text" href="#/wardrobe">先整理衣橱</a>
            </div>
          </div>

          <div class="mn-hero__plate">
            <figure class="mn-plate__main">
              <img src="/taste-shell/assets/hero-mirrors.jpg" alt="三面拱形穿衣镜斜靠在暖白石膏墙上" />
            </figure>
            <figure class="mn-plate__side">
              <img src="/taste-shell/assets/tights-macro.jpg" alt="黑色丝袜在小腿处的细节" />
            </figure>
            <figure class="mn-plate__foot">
              <img src="/taste-shell/assets/silk-drape.jpg" alt="黑色缎面布料垂落在石膏台面上" />
            </figure>
            <p class="mn-plate__caption">镜室、织物与衣物特写，都不放人像：人物只在真正试穿时出现。</p>
          </div>
        </section>

        <section class="mn-facts" aria-label="照花的能力范围">
          ${factRows}
        </section>

        <section class="mn-compose" aria-labelledby="compose-title">
          <div class="mn-compose__head">
            <h2 id="compose-title" class="mn-section__title">一套衣服，<br />先算清位置。</h2>
            <p class="mn-section__lead">照花按七类槽位理解穿搭，冲突在拍摄前解决。选满槽位，就能直接带进无影棚。</p>
          </div>
          ${renderComposer(state)}
        </section>

        <section class="mn-stills" aria-labelledby="stills-title">
          <div class="mn-stills__head">
            <h2 id="stills-title" class="mn-section__title">衣物在镜前，<br />先是实物。</h2>
            <p class="mn-section__lead">台照、材质、垂坠与袜子密度，都是试穿前能看清的事。照花把它们和成片放在同一条线上。</p>
          </div>
          <div class="mn-stills__grid">
            ${stillCards}
          </div>
        </section>

        <section class="mn-steps" aria-labelledby="steps-title">
          <h2 id="steps-title" class="mn-section__title mn-steps__title">一间镜室，<br />三步走完。</h2>
          <div class="mn-steps__grid">
            ${stepCards}
          </div>
        </section>

        <section class="mn-trust" aria-labelledby="trust-title">
          <div class="mn-trust__text">
            <h2 id="trust-title" class="mn-trust__title">成片不是终点，<br />能翻回去查才是。</h2>
            <p class="mn-trust__lead">每张成片都记着模型、姿势、背景与当时那套单品。改一件、重拍一次，前后可以对着看。</p>
          </div>
          <div class="mn-trust__actions">
            <a class="mn-btn mn-btn--inverse" href="#/me">打开试穿记录</a>
            <a class="mn-btn mn-btn--inverse-text" href="#/settings">选择图像模型</a>
          </div>
        </section>
      </main>

      <footer class="mn-footer">
        <div class="mn-footer__row">
          <span>照花 · 虚拟试衣与个人衣橱</span>
          <nav class="mn-footer__links" aria-label="页脚导航">
            <a href="#/studio">工作台</a>
            <a href="#/wardrobe">衣橱</a>
            <a href="#/shop">橱窗</a>
            <a href="#/me">记录</a>
          </nav>
          <span class="mn-footer__meta">交互壳子 · 未接后端</span>
        </div>
      </footer>
    </div>
  `;
}
