import React, { useEffect, useMemo, useState } from 'react';
import ProcessingReview from './ProcessingReview.jsx';
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
  const [openingId, setOpeningId] = useState('');
  const [selected, setSelected] = useState(null);

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

  async function openRecord(record) {
    setOpeningId(record.id);
    setError('');
    try {
      const response = await fetch(`/api/sharepoint/panel-records/${encodeURIComponent(record.id)}`, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The saved panel could not be opened.');
      setSelected(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (openError) {
      setError(openError.message);
    } finally {
      setOpeningId('');
    }
  }

  if (selected) {
    const job = selected.finalization?.job || selected.record?.job || { id: selected.jobNumber, customer: '', address: selected.address };
    const panel = selected.finalization?.panel || selected.record?.panel || { name: selected.panelName || 'Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '' };
    return (
      <div className="historyReviewShell">
        <header className="historyReviewHeader">
          <button type="button" onClick={() => setSelected(null)}>← Past Jobs</button>
          <span>Job #{job.id || selected.jobNumber} · {panel.name}</span>
        </header>
        <ProcessingReview
          key={`${selected.id}-${selected.finalization?.verifiedAt || 'ai'}`}
          job={job}
          panel={panel}
          photoUrls={selected.overviewPhotoUrl ? { breakerField: selected.overviewPhotoUrl } : {}}
          savedRecord={{ ...selected, listItemId: selected.id }}
          onStartOver={() => setSelected(null)}
          returnLabel="Back to Past Jobs"
        />
      </div>
    );
  }

  return (
    <div className="historyShell">
      <header className="historyHeader">
        <a className="historyBack" href="/">← Panel Labeler</a>
        <div>
          <p className="eyebrow">Saved records</p>
          <h1>Past Panel Jobs</h1>
          <p className="muted">Reopen AI results, continue verification, download completed directories, or view the original photos.</p>
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
                  {record.verifiedBy && <span><b>Verified by</b>{record.verifiedBy}{record.verifiedAt ? ` · ${formatDate(record.verifiedAt)}` : ''}</span>}
                </div>
              </div>
              <div className="historyActions">
                <button className="primary historyOpen" disabled={openingId === record.id} onClick={() => openRecord(record)}>
                  {openingId === record.id ? 'Opening…' : /verified/i.test(record.status || '') ? 'Open Final Directory' : 'Continue Verification'}
                </button>
                {(record.finalPdfUrl || /verified/i.test(record.status || '')) && <a className="secondary historyOpen" href={`/api/sharepoint/panel-records/${encodeURIComponent(record.id)}/final-directory`}>Download PDF</a>}
                {record.folderUrl ? <a className="secondary historyOpen" href={record.folderUrl} target="_blank" rel="noreferrer">Open Photos</a> : <button className="secondary" disabled>No folder link</button>}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
