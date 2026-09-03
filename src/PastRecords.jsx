import React, { useEffect, useMemo, useState } from 'react';
import './PastRecords.css';

function formatDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function PastRecords() {
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        const response = await fetch('/api/sharepoint/panel-records');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load past records.');
        if (active) setRecords(data.records || []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) => `${record.jobNumber} ${record.address} ${record.panelName} ${record.recordId}`.toLowerCase().includes(q));
  }, [records, query]);

  return (
    <div className="historyShell">
      <header className="historyHeader">
        <a className="historyBack" href="/">← Panel Labeler</a>
        <div>
          <p className="eyebrow">Saved records</p>
          <h1>Past Panel Jobs</h1>
          <p className="muted">Review prior addresses, open the SharePoint folder, and compare what was captured.</p>
        </div>
      </header>

      <main className="historyContent">
        <input className="historySearch" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search address, job number, panel, or record ID" />
        {loading && <div className="historyState">Loading saved panel records…</div>}
        {error && <div className="historyState historyError">{error}</div>}
        {!loading && !error && filtered.length === 0 && <div className="historyState">No matching panel records found.</div>}
        <div className="historyList">
          {filtered.map((record) => (
            <article className="historyCard" key={record.id || record.recordId}>
              <div className="historyCardMain">
                <div className="historyCardTopline"><span>Job #{record.jobNumber || '—'}</span><span>{formatDate(record.capturedAt)}</span></div>
                <h2>{record.address || 'Address not indexed'}</h2>
                <div className="historyMeta">
                  <span><b>Panel</b>{record.panelName || 'Unknown'}</span>
                  <span><b>Record</b>{record.recordId || '—'}</span>
                  <span><b>Photos</b>{record.capturedPhotos ?? '—'} captured{record.skippedPhotos ? ` · ${record.skippedPhotos} skipped` : ''}</span>
                  <span><b>Status</b>{record.status || 'Saved'}</span>
                </div>
              </div>
              <div className="historyActions">
                {record.folderUrl ? <a className="primary historyOpen" href={record.folderUrl} target="_blank" rel="noreferrer">Open Photos</a> : <button className="secondary" disabled>No folder link</button>}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
