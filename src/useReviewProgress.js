import { useEffect, useRef, useState } from 'react';

export default function useReviewProgress({ itemId, recordId, rows, resolutions, setRows, setResolutions, finalizedAt }) {
  const [ready, setReady] = useState(!itemId);
  const [status, setStatus] = useState('Loading saved review…');
  const [retry, setRetry] = useState(0);
  const [reload, setReload] = useState(0);
  const remoteLoaded = useRef(false);
  const lastSaved = useRef('');
  const queue = useRef(Promise.resolve());
  const key = recordId ? `gen3-panel-review:${recordId}` : null;
  const url = itemId ? `/api/sharepoint/panel-records/${encodeURIComponent(itemId)}/review-progress` : null;
  useEffect(() => {
    let active = true;
    async function load() {
      let local = null;
      try { if (key) local = JSON.parse(localStorage.getItem(key)); } catch { /* unavailable device storage */ }
      let remote = null;
      remoteLoaded.current = false;
      let failed = false;
      try {
        if (url) {
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Review could not be loaded.');
          remote = data.progress;
          if (active) remoteLoaded.current = true;
        }
      } catch { failed = true; }
      if (!active) return;
      const draft = local && (!remote || Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) ? local : remote;
      if (draft?.recordId === recordId && Array.isArray(draft.rows) && (!finalizedAt || Date.parse(draft.updatedAt) > Date.parse(finalizedAt))) {
        setRows(draft.rows); setResolutions(draft.resolutions || {});
        lastSaved.current = draft === remote ? JSON.stringify({ rows: draft.rows, resolutions: draft.resolutions || {} }) : '';
      } else if (finalizedAt && draft?.resolutions) setResolutions(draft.resolutions);
      setStatus(failed ? 'Could not load shared progress. Changes will stay on this device until saved.' : 'Review loaded');
      setReady(true);
      if (!failed && reload) setRetry((value) => value + 1);
    }
    load();
    return () => { active = false; };
  }, [url, key, reload]);

  useEffect(() => {
    if (!ready || !key) return;
    const snapshot = JSON.stringify({ rows, resolutions });
    if (snapshot === lastSaved.current && !retry) return;
    const progress = { recordId, rows, resolutions, updatedAt: new Date().toISOString() };
    let stored = false;
    try { localStorage.setItem(key, JSON.stringify(progress)); stored = true; } catch { /* show actual save status below */ }
    setStatus(stored ? 'Saved on this device · saving to SharePoint…' : 'Saving to SharePoint…');
    if (!url) { setStatus(stored ? 'Saved on this device only' : 'Progress could not be saved.'); return; }
    if (!remoteLoaded.current) { setStatus(stored ? 'Saved on this device. Tap Save progress to reconnect before syncing.' : 'Could not save progress. Tap Save progress to retry.'); return; }
    let active = true;
    const timer = setTimeout(() => {
      queue.current = queue.current.catch(() => {}).then(async () => {
        try {
          const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(progress) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Save failed.');
          lastSaved.current = snapshot;
          if (active) setStatus('Review progress saved to SharePoint');
        } catch { if (active) setStatus(stored ? 'Saved on this device only · SharePoint save failed. Retry when online.' : 'Progress was not saved. Please retry.'); }
      });
    }, 900);
    return () => { active = false; clearTimeout(timer); };
  }, [ready, rows, resolutions, url, key, retry]);
  return { ready, status, retry: () => { if (!remoteLoaded.current) setReload((value) => value + 1); else setRetry((value) => value + 1); } };
}
