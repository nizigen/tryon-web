import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../public/lib/api.js';
import { errorText } from '../ui.jsx';

export function useWardrobeItems() {
  const [request, setRequest] = useState({ query: '', focusId: null });
  const [data, setData] = useState({ items: [], matches: [], request: null, error: '' });
  const closetRef = useRef(null);
  const uploadButton = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const search = request.query ? api('/api/wardrobe/search', { method: 'POST', body: { query: request.query }, signal }) : null;
    Promise.all([api('/api/wardrobe', { signal }), search]).then(([inventory, result]) => {
      if (signal.aborted) return;
      const items = inventory.items ?? [];
      const matches = result ? result.results.map(entry => entry.item.id) : items.map(item => item.id);
      setData({ items, matches, request, error: '' });
    }).catch(error => {
      if (!signal.aborted) setData(current => ({ ...current, request, error: errorText(error) }));
    });
    return () => controller.abort();
  }, [request]);

  useLayoutEffect(() => {
    if (!data.request?.focusId) return;
    const cards = [...(closetRef.current?.querySelectorAll('[data-item-id]') ?? [])];
    const card = cards.find(node => node.dataset.itemId === data.request.focusId) || cards[0];
    const target = card?.querySelector('[aria-haspopup="menu"]') || uploadButton.current;
    target?.focus({ preventScroll: true });
  }, [data.request]);

  const byId = new Map(data.items.map(item => [item.id, item]));
  return {
    items: data.items, byId, matched: data.matches.map(id => byId.get(id)).filter(Boolean),
    loading: data.request !== request, error: data.error, query: request.query,
    closetRef, uploadButton,
    search: query => setRequest({ query: query.trim(), focusId: null }),
    refresh: focusId => setRequest(current => ({ ...current, focusId })),
  };
}

