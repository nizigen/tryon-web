import { useLayoutEffect, useRef } from 'react';

const steps = [['person', '选人物'], ['pieces', '搭衣服'], ['shoot', '试拍'], ['result', '看结果']];

export default function FlowNav({ draft, count, onChange }) {
  const { person, mode, step, shoot } = draft;
  const nav = useRef(null);
  const previous = useRef(step);
  useLayoutEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    const current = nav.current?.querySelector('[aria-current="step"]');
    current?.focus({ preventScroll: true });
    if (step !== 'result') current?.scrollIntoView({ block: 'nearest' });
  }, [step]);
  const done = shoot.shots.filter(shot => shot.status === 'success').length;
  const notes = { person: person.image ? person.isDefault ? '内置模特' : '你的照片' : '待选择', pieces: count ? `已选 ${count} 件` : '待搭配',
    shoot: mode === 'studio' ? '无影棚' : '普通试穿', result: !shoot.shots.length ? '尚未试拍' : shoot.busy ? '拍摄中' : `${done}/${shoot.shots.length} 张完成` };
  return <nav ref={nav} className="studio-flow" aria-label="试穿步骤"><ol>{steps.map(([key, label], index) => <li key={key}>
    <button type="button" data-studio-step={key} aria-controls={`studio-step-${key}`} aria-current={key === step ? 'step' : undefined}
      disabled={(shoot.busy && key !== 'result') || (key === 'result' && !shoot.shots.length)} onClick={() => onChange(key)}>
      <span aria-hidden="true">{index + 1}</span><strong>{label}</strong><small>{notes[key]}</small>
    </button></li>)}</ol></nav>;
}
