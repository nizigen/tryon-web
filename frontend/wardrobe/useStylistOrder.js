import { useEffect, useRef, useState } from 'react';
import { api, deviceId, getSessionId, setSessionId } from '../../public/lib/api.js';
import { selectedPieces } from '../studio/pieces.js';
import { STAGES, useShoot } from '../studio/useShoot.js';
import { errorText, toast } from '../ui.jsx';

export function useStylistOrder() {
  const { shoot, run, reset } = useShoot();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function generate({ model, person, pieces }) {
    if (inFlight.current || !person.image || !pieces.length) return;
    inFlight.current = true;
    setError('');
    setPreparing(true);
    try {
      let sessionId = getSessionId();
      if (!sessionId) {
        const session = await api('/api/session', { method: 'POST', body: { deviceId: deviceId() } });
        if (!alive.current) return;
        sessionId = session.sessionId;
        setSessionId(sessionId);
      }
      const garments = selectedPieces(pieces).map(piece => ({ ...piece, source: { kind: 'wardrobe', wardrobeId: piece.source.wardrobeId } }));
      setPreparing(false);
      await run({ sessionId, person: person.image, personSource: person.isDefault ? 'builtin' : 'upload', model: model || undefined, fit: 'regular', prompt: '', pieces: garments });
    } catch (failure) {
      if (alive.current) { const message = errorText(failure); setError(message); toast(message); }
    } finally {
      inFlight.current = false;
      if (alive.current) setPreparing(false);
    }
  }

  const result = shoot.shots[0];
  const text = preparing ? '正在提交试穿…' : shoot.busy ? STAGES[shoot.stage] || STAGES.generating : error || result?.errorMessage || '';
  return { generate, text, result, busy: preparing || shoot.busy, clear() { reset(); setError(''); } };
}
