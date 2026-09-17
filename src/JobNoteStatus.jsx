import React, { useEffect, useState } from 'react';
import './JobNoteStatus.css';

export default function JobNoteStatus({ endpoint, initial }) {
  const [delivery, setDelivery] = useState(initial || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (endpoint) fetch(endpoint).then(async response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Job-note status could not be loaded. Sign in again if your session expired.');
      const data = await response.json();
      if (active) setDelivery(data);
    }).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [endpoint]);
  async function retry() {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST' });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Please sign in again and retry.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update the job note. Please retry.');
      setDelivery(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const complete = ['sent', 'not_linked'].includes(delivery?.status);
  const checking = ['uncertain', 'sending', 'pending'].includes(delivery?.status);
  return <section className={`jobNoteStatus noPrint ${delivery?.status === 'sent' ? 'sent' : ''}`} aria-label="ServiceTitan job note">
    <strong>ServiceTitan job note</strong>
    <p role="status">{busy ? 'Updating job notes…' : delivery?.message || 'Checking job-note status…'}</p>
    {error && <p role="alert">{error}</p>}
    {endpoint && (!complete || error) && <button className="secondary" type="button" disabled={busy} onClick={retry}>{busy ? 'Please wait…' : checking ? 'Check delivery' : delivery?.status === 'not_sent' ? 'Add report link to job notes' : 'Retry job note'}</button>}
    {delivery?.status === 'sent' && <small>Report access remains restricted to authorized GEN3 users.</small>}
  </section>;
}
