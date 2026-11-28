import { DEFAULT_PERSON_URL } from '../public/lib/person.js';
import { Icon } from './ui.jsx';

const garmentExamples = [
  { file: 'sweater-knit.jpg', name: '米色麻花针织毛衣', width: 900, height: 822 },
  { file: 'skirt-pleated.jpg', name: '灰色百褶裙', width: 900, height: 985 },
  { file: 'blouse-linen.jpg', name: '白色亚麻衬衫', width: 900, height: 822 },
];

export default function Home() {
  return <>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero__copy">
        <h1 id="home-title">穿之前，<br />先看看。</h1>
        <p>用自己的照片，或选照花模特，在线试穿你搭好的衣服。</p>
        <div className="home-hero__actions">
          <a className="btn btn--primary btn--lg" href="#/studio">开始试穿<Icon name="arrow" /></a>
          <a className="home-link" href="#/wardrobe">打开衣橱</a>
        </div>
      </div>
      <figure className="home-hero__media">
        <div className="home-hero__frame"><img src={DEFAULT_PERSON_URL} width="1024" height="1536" fetchPriority="high" alt="照花内置模特，白色上衣、深灰长裤与自然披下的黑色长发" /></div>
        <figcaption><span>内置模特参考</span><span>AI 生成</span></figcaption>
      </figure>
    </section>
    <section className="home-closet" aria-labelledby="home-closet-title">
      <div className="home-closet__copy">
        <h2 id="home-closet-title">从衣橱挑一套</h2>
        <p>上传衣服照片，或从商品链接导入。挑好想搭在一起的单品，就能带进试衣间。</p>
        <a className="home-link" href="#/wardrobe">整理我的衣橱<Icon name="arrow" /></a>
      </div>
      <figure className="home-closet__media">
        <div className="home-closet__photos">{garmentExamples.map(({ file, name, width, height }) =>
          <img key={file} src={`/catalog/${file}`} width={width} height={height} alt={name} />)}</div>
        <figcaption>目录单品示意 · AI 生成</figcaption>
      </figure>
    </section>
    <footer className="home-footer">照花 <span>AI 试穿仅供搭配参考。</span></footer>
  </>;
}
