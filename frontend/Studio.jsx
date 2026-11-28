import { getSessionId } from '../public/lib/api.js';
import { Icon, toast } from './ui.jsx';
import FlowNav from './studio/FlowNav.jsx';
import PersonCard, { ShootReferences } from './studio/PersonCard.jsx';
import { FitOptions, Photography } from './studio/Photography.jsx';
import PieceSlots from './studio/PieceSlots.jsx';
import Results from './studio/Results.jsx';
import { MAX_PIECES, recommendedPoses, selectedPieces, submitIssue } from './studio/pieces.js';
import { STAGES } from './studio/useShoot.js';

function SubmitControls({ count, shoot, issue, studio, firstPose, fullBatch, onSubmit }) {
  const locked = shoot.busy || Boolean(issue);
  const multiple = shoot.shots.length > 1;
  const primary = studio ? (shoot.busy && multiple ? `正在生成 ${shoot.index + 1}/${shoot.shots.length}` : '生成 3 个姿势') : (shoot.busy ? '生成中…' : '生成试穿图');
  return <section className="card studio__submit-card"><div className="studio__submit">
    <div className="studio__submit-info"><span className={`studio__count${issue.includes('太大') ? ' is-over' : ''}`}>{issue || `已选 ${count} 件单品（最多 ${MAX_PIECES} 件）`}</span></div>
    <span className="push-end">
      <span className="studio__busy" hidden={!shoot.busy}><span className="spinner" />{shoot.batch && !multiple ? '单张试拍 · ' : ''}{STAGES[shoot.stage] ?? STAGES.generating}</span>
      <button type="button" className="btn btn--primary btn--lg btn--block" disabled={locked || (studio && !fullBatch)} onClick={() => onSubmit(false)}>{primary}</button>
      <button type="button" className="btn btn--sm studio__trial" hidden={!studio} disabled={locked || !studio || !firstPose} onClick={() => onSubmit(true)}>只试拍：{firstPose?.label ?? '第 1 个姿势'}</button>
    </span>
  </div></section>;
}

export default function Studio({ ctx }) {
  const { config, model, draft } = ctx;
  const { shoot, run, entries, setEntries, person, selectPerson, restorePerson, mode, setMode,
    fit, setFit, prompt, setPrompt, setBackground, customPoses, setCustomPoses, step, setStep } = draft;
  const background = draft.background ?? config.defaultStudioPreset ?? 'clean-white-seamless';
  const pieces = selectedPieces(entries);
  const options = config.posePresets ?? [];
  const poses = customPoses ?? recommendedPoses(pieces).filter(id => options.some(pose => pose.id === id));
  const issue = submitIssue(person, entries, pieces);
  const studio = mode === 'studio';

  const changeStep = next => { if (!shoot.busy) setStep(next); };
  function submit(trial = false) {
    if (shoot.busy || (trial && !studio) || (studio && poses.length < (trial ? 1 : 3))) return;
    if (issue) { toast(issue); return; }
    const body = { sessionId: getSessionId(), model: model ?? undefined, person: person.image,
      personSource: person.isDefault ? 'builtin' : 'upload', pieces, fit, prompt: prompt.trim() };
    setStep('result');
    if (studio) void run({ ...body, photographyMode: 'studio', studioPreset: background }, poses.slice(0, trial ? 1 : 3));
    else void run(body);
  }
  return <>
    <header className="page-head"><h1 className="page-title">试穿工作台</h1>
      <p className="page-sub">选好人物和衣服，再决定怎么拍。</p></header>
    <FlowNav draft={draft} count={pieces.length} onChange={changeStep} />
    <div className="studio" data-current-step={step}>
      <Results person={person} shoot={shoot} config={config} showOutput={step === 'result'} />
      <div className="studio__controls">
        <fieldset id="studio-step-person" aria-label="选人物" className="studio-panel" hidden={step !== 'person'} disabled={shoot.busy}><PersonCard person={person} onSelect={file => { if (!shoot.busy) void selectPerson(file); }} onRestore={restorePerson} mode={mode} /></fieldset>
        <fieldset id="studio-step-pieces" aria-label="搭衣服" className="studio-panel" hidden={step !== 'pieces'} disabled={shoot.busy}><PieceSlots entries={entries} setEntries={setEntries}>
          <button type="button" className="btn btn--ghost" onClick={() => ctx.onNavigate('wardrobe')}>去衣橱挑一套</button></PieceSlots></fieldset>
        <fieldset id="studio-step-shoot" aria-label="试拍" className="studio-panel" hidden={step !== 'shoot'} disabled={shoot.busy}>
          <section className="card"><div className="card__head"><h2 className="section__title">试拍设置</h2></div>
            <Photography config={config} mode={mode} setMode={setMode} background={background} setBackground={setBackground} poses={poses} setPoses={setCustomPoses} busy={shoot.busy} />
            {studio && person.isDefault && <ShootReferences />}
            <FitOptions config={config} disabled={shoot.busy} fit={fit} setFit={setFit} prompt={prompt} setPrompt={setPrompt} /></section>
        </fieldset>
        <div hidden={step !== 'shoot' && !shoot.busy}><SubmitControls count={pieces.length} shoot={shoot} issue={issue} studio={studio} firstPose={options.find(pose => pose.id === poses[0])} fullBatch={poses.length === 3} onSubmit={submit} /></div>
        {step === 'person' && <button type="button" className="btn btn--primary" disabled={!person.image} onClick={() => changeStep(pieces.length ? 'shoot' : 'pieces')}>{pieces.length ? '去试拍' : '去搭衣服'}</button>}
        {step === 'pieces' && <div className="studio-next"><p className={issue && pieces.length ? 'studio__hint' : 'field__hint'} role="status">{issue || `已选 ${pieces.length} 件，可以试拍了。`}</p><button type="button" className="btn btn--primary" disabled={Boolean(issue)} onClick={() => changeStep('shoot')}>去试拍</button></div>}
        {step === 'shoot' && issue && <button type="button" className="btn" onClick={() => changeStep(person.image ? 'pieces' : 'person')}>{person.image ? '返回搭衣服' : '返回选人物'}</button>}
        {step === 'result' && !shoot.busy && <button type="button" className="btn" onClick={() => changeStep('shoot')}>返回试拍设置</button>}
        <p className="studio__legal"><Icon name="shield" />人物照片只用于本次试穿。</p>
      </div>
    </div>
  </>;
}
