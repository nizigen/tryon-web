import { useState } from 'react';

import { toast } from '../ui.jsx';
import { usePerson } from './PersonCard.jsx';
import { initialPieces, MAX_PIECES } from './pieces.js';
import { useShoot } from './useShoot.js';

export function useStudioDraft(route) {
  const studioRoute = route === 'studio' || route === 'tryon';
  const [person, selectPerson, restorePerson] = usePerson(studioRoute || route === 'wardrobe');
  const [entries, setEntries] = useState(initialPieces);
  const [mode, setMode] = useState('preserve');
  const [fit, setFit] = useState('regular');
  const [prompt, setPrompt] = useState('');
  const [background, setBackground] = useState(null);
  const [customPoses, setCustomPoses] = useState(null);
  const [step, setStep] = useState('pieces');
  const { shoot, run } = useShoot(studioRoute);

  function takeOutfit(seed, kind, photographyMode) {
    if (shoot.busy) return false;
    const incoming = initialPieces(seed);
    const kept = entries.filter(entry => entry.source || entry.error || entry.readToken);
    const next = kind === 'product'
      ? [...kept, ...incoming.filter(item => !kept.some(entry => entry.source?.productId === item.source.productId))]
      : kind === 'wardrobe'
        ? [...kept.filter(entry => entry.source?.kind !== 'wardrobe'), ...incoming.map(item => kept.find(entry => entry.source?.wardrobeId === item.source.wardrobeId) ?? item)]
        : incoming;
    if (next.length > MAX_PIECES) { toast(`这套最多 ${MAX_PIECES} 件，请在工作台移除一件再添加`); return false; }
    setEntries(next);
    if (photographyMode) setMode(photographyMode);
    setStep('shoot');
    return true;
  }

  return { person, selectPerson, restorePerson, entries, setEntries, mode, setMode, fit, setFit, prompt, setPrompt,
    background, setBackground, customPoses, setCustomPoses, step, setStep, shoot, run, takeOutfit };
}
