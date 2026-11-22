import { h } from '../lib/dom.js';
import { SLOTS } from '../lib/garment-taxonomy.js';

/**
 * 我的衣橱：首版没有独立的衣橱持久化接口，这里先提供品类参考与进入工作台的入口，
 * 不伪造不存在的「已收藏单品」数据。
 */
export function renderWardrobe(root, ctx) {
  const groups = SLOTS.map((slot) => h('div', { class: 'wardrobe__group' }, [
    h('div', { class: 'wardrobe__group-head' }, [
      h('span', { class: 'slot__pill', text: slot.label }),
      h('span', { class: 'field__hint', text: slot.hint || '' }),
    ]),
    h('div', { class: 'tag-row' }, slot.subtypes.slice(0, 8).map((name) => h('span', { class: 'tag', text: name }))),
  ]));

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '我的衣橱' }),
      h('p', { class: 'page-sub', text: '按品类浏览常见子类；想直接搭配，去工作台挑单品试穿。' }),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'studio__submit' }, [
        h('span', { class: 'field__hint', text: '衣橱收藏功能尚未开放，当前展示的是可搭配的品类参考。' }),
        h('span', { class: 'push-end' }, [
          h('button', { type: 'button', class: 'btn btn--primary', text: '去搭配工作台', onclick: () => ctx.onNavigate('studio') }),
        ]),
      ]),
    ]),
    h('div', { class: 'wardrobe' }, groups),
  );
}
