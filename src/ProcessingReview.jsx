import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ProcessingReview.css';
import PhotoGallery from './PhotoGallery.jsx';
import ReviewChecklist from './ReviewChecklist.jsx';
import useReviewProgress from './useReviewProgress.js';
import { verifyCircuit } from './reviewProgress.js';
import PanelFlipControl from './PanelFlipControl.jsx';
import { normalizeNumberingOrigin, numberingLayout, panelDisplayPairs, breakerPlacement, adjacentCircuit } from './panelLayout.js';
import { buildRowsFromAnalysis, getAIAnalysis } from './panelAnalysis.js';

const commonCircuits = [
  'Kitchen','Kitchen Receptacles','Kitchen Lighting','Kitchen Counter','Dining Room','Dining Room Lights','Living Room','Living Room Lights',
  'Bedroom 1','Bedroom 2','Bedroom 3','Bedroom Lights','Bathroom','Bathroom Lights','Bathroom GFCI','Laundry','Washer','Dryer',
  'Dishwasher','Garbage Disposal','Microwave','Range','Refrigerator','Basement','Basement Lights','Garage','Garage Receptacles',
  'Exterior','Exterior Lights','Exterior / GFCI','Smoke / CO','HVAC','Air Handler','Condenser','Heat Pump','Water Heater','Boiler',
  'Sump Pump','EV Charger','Pool','Spa','Hot Tub','Subpanel','Surge Protector','Lighting','Receptacles','Spare','Unknown'
];

const breakerKinds = [
  { value: 'empty', label: 'Empty / No Breaker', poles: 1, family: 'standard' },
  { value: '1p_unknown', label: '1P Verify Type', poles: 1, family: 'standard' },
  { value: '2p_unknown', label: '2P Verify Type', poles: 2, family: 'standard' },
  { value: '1p_standard', label: '1P Standard', poles: 1, family: 'standard' },
  { value: '2p_standard', label: '2P Standard', poles: 2, family: 'standard' },
  { value: '1p_afci', label: '1P AFCI', poles: 1, family: 'afci' },
  { value: '2p_afci', label: '2P AFCI', poles: 2, family: 'afci' },
  { value: '1p_gfci', label: '1P GFCI', poles: 1, family: 'gfci' },
  { value: '2p_gfci', label: '2P GFCI', poles: 2, family: 'gfci' },
  { value: '1p_dual', label: '1P Dual Function', poles: 1, family: 'dual' },
  { value: '2p_dual', label: '2P Dual Function', poles: 2, family: 'dual' },
  { value: '1p_surge', label: '1P Surge', poles: 1, family: 'surge' },
  { value: '2p_surge', label: '2P Surge', poles: 2, family: 'surge' },
];

const kindByValue = Object.fromEntries(breakerKinds.map((kind) => [kind.value, kind]));

function breakerFamily(row) {
  return kindByValue[row.breakerKind]?.family || 'standard';
}

function descriptionFontSize(text) {
  const length = (text || '').length;
  if (length > 150) return '10px';
  if (length > 95) return '11px';
  if (length > 55) return '12px';
  return '13px';
}

export default function ProcessingReview({ job, panel, photoUrls, savedRecord, onFinalized, onStartOver, returnLabel = 'Start Another Panel' }) {
  const analysis = useMemo(() => getAIAnalysis(savedRecord), [savedRecord]);
  const previousFinalization = savedRecord?.finalization || savedRecord?.receipt?.finalization || null;
  const [numberingOrigin, setNumberingOrigin] = useState(() => normalizeNumberingOrigin(previousFinalization?.panel?.numberingOrigin || panel.numberingOrigin));
  const layout = numberingLayout(numberingOrigin);
  const normalized = useMemo(() => buildRowsFromAnalysis({ ...panel, numberingOrigin }, analysis), [panel, analysis, numberingOrigin]);
  const [phase, setPhase] = useState(() => (previousFinalization ? 'final' : analysis ? 'review' : 'ready'));
  const [rows, setRows] = useState(() => previousFinalization?.rows || normalized.rows);
  const [resolutions, setResolutions] = useState(() => previousFinalization?.reviewResolutions || {});
  const [openPhoto, setOpenPhoto] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const reviewDialog = useRef(null);
  useEffect(() => {
    if (!reviewTarget || !reviewDialog.current) return;
    const popup = reviewDialog.current;
    popup.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; if (popup.open) popup.close(); };
  }, [reviewTarget]);
  function openReview(circuit = null) { setReviewTarget({ circuit }); }
  function closeReview() { reviewDialog.current?.close(); }

  const progress = useReviewProgress({ itemId: savedRecord?.listItemId || savedRecord?.id || savedRecord?.receipt?.listItemId, recordId: savedRecord?.recordId || savedRecord?.receipt?.recordId, rows, resolutions, numberingOrigin, setNumberingOrigin: (origin) => { setNumberingOrigin(origin); if (previousFinalization && origin !== normalizeNumberingOrigin(previousFinalization.panel?.numberingOrigin)) setPhase('review'); }, setRows, setResolutions, finalizedAt: previousFinalization?.verifiedAt });
  const [labelQueries, setLabelQueries] = useState({});
  const [verifierName, setVerifierName] = useState(() => previousFinalization?.verifiedBy || localStorage.getItem('gen3-panel-verifier-name') || '');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [finalReceipt, setFinalReceipt] = useState(previousFinalization);
  const analysisWarnings = [...new Set([...(Array.isArray(analysis?.warnings) ? analysis.warnings : []), ...normalized.warnings].map(String))];
  const analyzedPanel = analysis?.panel || {};
  const panelManufacturer = panel.manufacturer && panel.manufacturer !== 'Unknown' ? panel.manufacturer : analyzedPanel.manufacturer || 'Verify';
  const panelMainAmps = panel.mainAmps || analyzedPanel.mainAmps || null;

  const gallery = <PhotoGallery key={savedRecord?.recordId || 'current'} photoUrls={photoUrls} compact={phase === 'review'} openPhoto={openPhoto} itemId={savedRecord?.listItemId || savedRecord?.id || savedRecord?.receipt?.listItemId} folderUrl={savedRecord?.folderUrl} />;

  function runPreview() {
    setPhase('review');
  }

  async function finalizeDirectory() {
    const verifiedBy = verifierName.trim();
    if (!verifiedBy) {
      setFinalizeError('Enter the name of the person who verified the directory.');
      return;
    }
    setFinalizing(true);
    setFinalizeError('');
    const receipt = savedRecord?.receipt || savedRecord || {};
    try {
      const response = await fetch('/api/sharepoint/panel-records/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          recordId: receipt.recordId,
          listItemId: receipt.listItemId,
          driveId: receipt.driveId,
          folderId: receipt.folderId,
          folderUrl: receipt.folderUrl,
          verifiedBy,
          job,
          panel: { ...panel, manufacturer: panelManufacturer, mainAmps: panelMainAmps, numberingOrigin },
          rows,
          reviewResolutions: resolutions,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The final directory could not be saved.');
      const saved = { ...result, rows, panel: { ...panel, manufacturer: panelManufacturer, mainAmps: panelMainAmps, numberingOrigin } };
      localStorage.setItem('gen3-panel-verifier-name', verifiedBy);
      setFinalReceipt(saved);
      setPhase('final');
      if (onFinalized) await onFinalized(saved);
    } catch (error) {
      setFinalizeError(error.message || 'The final directory could not be saved.');
    } finally {
      setFinalizing(false);
    }
  }

  function updateCircuit(circuit, key, value) {
    setRows((current) => current.map((row) => {
      if (row.circuit === circuit || row.continuationOf === circuit) return { ...row, [key]: value, confidence: 'Review' };
      return row;
    }));
  }

  function appendCommonLabel(circuit, label) {
    setRows((current) => current.map((row) => {
      if (row.circuit !== circuit && row.continuationOf !== circuit) return row;
      const existing = (row.description || '').trim();
      const parts = existing.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
      if (parts.includes(label.toLowerCase())) return row;
      const next = existing ? `${existing}, ${label}` : label;
      return { ...row, description: next.slice(0, 280), confidence: 'Review' };
    }));
  }

  function changeBreakerKind(circuit, breakerKind) {
    setRows((current) => {
      const target = current.find((r) => r.circuit === circuit);
      if (!target || target.continuationOf) return current;
      const next = current.find((r) => r.circuit === circuit + 2);
      const poles = kindByValue[breakerKind]?.poles || 1;
      return current.map((row) => {
        if (row.circuit === circuit) {
          if (breakerKind === 'empty') return { ...row, amps: null, description: '', breakerKind, confidence: 'Verified', notes: 'Marked empty during verification' };
          return { ...row, breakerKind, confidence: 'Review' };
        }
        if (poles === 2 && next && row.circuit === next.circuit) {
          return { ...row, continuationOf: circuit, amps: target.amps, description: target.description, breakerKind, confidence: 'Review' };
        }
        if (poles === 1 && row.continuationOf === circuit) {
          return { ...row, continuationOf: null, description: '', breakerKind: '1p_standard', confidence: 'Review' };
        }
        return row;
      });
    });
  }

  function clearBreaker(circuit) {
    if (!window.confirm(`Mark circuit ${circuit} as empty / no breaker?`)) return;
    setRows((current) => current.map((row) => {
      if (row.circuit === circuit || row.continuationOf === circuit) {
        return {
          ...row,
          continuationOf: null,
          amps: null,
          description: '',
          breakerKind: 'empty',
          confidence: 'Verified',
          notes: 'Marked empty during verification',
        };
      }
      return row;
    }));
  }

  function moveBreaker(circuit, direction) {
    const destinationCircuit = adjacentCircuit(circuit, direction, numberingOrigin);
    setRows((current) => {
      const source = current.find((row) => row.circuit === circuit);
      const destination = current.find((row) => row.circuit === destinationCircuit);
      if (!source || !destination || source.continuationOf || destination.continuationOf) return current;
      const sourcePoles = kindByValue[source.breakerKind]?.poles || 1;
      const destinationPoles = kindByValue[destination.breakerKind]?.poles || 1;
      if (sourcePoles !== 1 || destinationPoles !== 1) return current;

      const fields = ['amps', 'description', 'breakerKind', 'confidence', 'notes'];
      return current.map((row) => {
        if (row.circuit !== circuit && row.circuit !== destinationCircuit) return row;
        const other = row.circuit === circuit ? destination : source;
        const swapped = { ...row, continuationOf: null };
        fields.forEach((field) => { swapped[field] = other[field]; });
        swapped.confidence = 'Review';
        return swapped;
      });
    });
  }

  const byCircuit = Object.fromEntries(rows.map((row) => [row.circuit, row]));
  const displayPairs = panelDisplayPairs(rows.length, numberingOrigin);
  const physicalRows = displayPairs.length;

  function renderSide(circuit, side) {
    const row = byCircuit[circuit];
    if (!row || row.continuationOf) return null;

    const kind = kindByValue[row.breakerKind] || kindByValue['1p_unknown'];
    const placement = breakerPlacement(circuit, rows.length, numberingOrigin, kind.poles);
    const rowIndex = placement.row + 1;
    const rowSpan = placement.span;
    const query = labelQueries[row.circuit] || '';
    const filteredLabels = commonCircuits.filter((name) => name.toLowerCase().includes(query.toLowerCase())).slice(0, 14);
    const previousRow = byCircuit[adjacentCircuit(circuit, -1, numberingOrigin)];
    const nextRow = byCircuit[adjacentCircuit(circuit, 1, numberingOrigin)];
    const canMoveUp = kind.poles === 1 && previousRow && !previousRow.continuationOf && (kindByValue[previousRow.breakerKind]?.poles || 1) === 1;
    const canMoveDown = kind.poles === 1 && nextRow && !nextRow.continuationOf && (kindByValue[nextRow.breakerKind]?.poles || 1) === 1;
    const isEmpty = row.breakerKind === 'empty';

    return (
      <React.Fragment key={`${side}-${circuit}`}>
        <div className={`panelDescription ${side} ${row.confidence === 'Review' ? 'needsReview' : ''}`} style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }} title={row.notes ? `AI note: ${row.notes}` : undefined}>
          <span className="circuitNumber">{circuit}</span>
          <textarea
            className="circuitDescriptionInput"
            placeholder={isEmpty ? 'Empty space / no breaker' : 'Search or type circuit description…'}
            value={row.description}
            maxLength={280}
            rows={rowSpan === 2 ? 5 : 3}
            style={{ fontSize: descriptionFontSize(row.description) }}
            onChange={(e) => updateCircuit(row.circuit, 'description', e.target.value)}
            aria-label={`Circuit ${row.circuit} description`}
            disabled={isEmpty}
          />
          <div className="descriptionAssist">
            <details className="labelPicker">
              <summary>+ Add common labels</summary>
              <div className="labelPickerPanel">
                <input
                  value={query}
                  onChange={(e) => setLabelQueries((current) => ({ ...current, [row.circuit]: e.target.value }))}
                  placeholder="Search labels…"
                  aria-label={`Search common labels for circuit ${row.circuit}`}
                />
                <div className="labelChoices">
                  {filteredLabels.map((name) => (
                    <button type="button" key={name} onClick={() => appendCommonLabel(row.circuit, name)}>{name}</button>
                  ))}
                  {!filteredLabels.length && <span className="noLabels">No matching labels</span>}
                </div>
              </div>
            </details>
            <span>{row.description.length}/280</span>
          </div>
          <button type="button" className={`reviewFlag ${row.confidence === 'Review' ? '' : 'reviewFlagComplete'}`} onClick={() => openReview(row.circuit)} aria-label={`Review circuit ${row.circuit} AI note`}>{row.confidence === 'Review' ? (row.notes ? 'Review AI note' : 'Review circuit') : row.confidence === 'Verified' ? '✓ Verified' : 'AI note'}</button>
        </div>
        <div
          className={`breakerTile ${side} family-${kind.family} ${row.confidence === 'Review' ? 'needsReview' : ''} ${kind.poles === 2 ? 'twoPole' : ''}`}
          style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }}
        >
          {isEmpty ? (
            <div style={{ width: '100%', minHeight: 31, borderRadius: 7, background: 'rgba(255,255,255,.92)', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 900 }}>NO BREAKER</div>
          ) : (
            <select className="ampSelect" value={row.amps ?? ''} onChange={(e) => updateCircuit(row.circuit, 'amps', e.target.value ? Number(e.target.value) : null)} aria-label={`Circuit ${row.circuit} amps`}>
              <option value="">Verify amps</option>
              {[...new Set([15,20,25,30,40,50,60,70,80,90,100,125,150,175,200, row.amps].filter(Boolean))].sort((a, b) => a - b).map((amp) => <option key={amp} value={amp}>{amp}A</option>)}
            </select>
          )}
          <select className="breakerKindSelect" value={row.breakerKind} onChange={(e) => changeBreakerKind(row.circuit, e.target.value)} aria-label={`Circuit ${row.circuit} breaker type`}>
            {breakerKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
            <button type="button" disabled={!canMoveUp} onClick={() => moveBreaker(row.circuit, -1)} title="Move breaker up one position" aria-label={`Move circuit ${row.circuit} breaker up`} style={{ minHeight: 24, border: '1px solid rgba(12,41,74,.18)', borderRadius: 6, background: 'rgba(255,255,255,.9)', color: '#17314c', fontWeight: 900 }}>↑</button>
            <button type="button" disabled={!canMoveDown} onClick={() => moveBreaker(row.circuit, 1)} title="Move breaker down one position" aria-label={`Move circuit ${row.circuit} breaker down`} style={{ minHeight: 24, border: '1px solid rgba(12,41,74,.18)', borderRadius: 6, background: 'rgba(255,255,255,.9)', color: '#17314c', fontWeight: 900 }}>↓</button>
            <button type="button" onClick={() => clearBreaker(row.circuit)} title="Delete breaker from this position" aria-label={`Delete circuit ${row.circuit} breaker`} style={{ minHeight: 24, border: '1px solid rgba(148,44,32,.25)', borderRadius: 6, background: '#fff6f4', color: '#8e2d23', fontWeight: 900 }}>×</button>
          </div>
        </div>
      </React.Fragment>
    );
  }

  function PhysicalPanel() {
    const left = displayPairs.map((pair) => byCircuit[pair.left]).filter((row) => row && !row.continuationOf);
    const right = displayPairs.map((pair) => byCircuit[pair.right]).filter((row) => row && !row.continuationOf);
    return (
      <div className="panelGridScroll"><div className={`cleanPanelGrid ${layout.bottomUp ? 'bottomNumbering' : ''}`} style={{ '--panel-rows': physicalRows }}>
        <div className="panelGridHeader leftDescHead">{layout.oddLeft ? 'ODD' : 'EVEN'} / LEFT</div>
        <div className="panelGridHeader leftAmpHead">BREAKER</div>
        <div className="panelCenterLine" />
        <div className="panelGridHeader rightAmpHead">BREAKER</div>
        <div className="panelGridHeader rightDescHead">{layout.oddLeft ? 'EVEN' : 'ODD'} / RIGHT</div>
        {left.map((row) => renderSide(row.circuit, 'left'))}
        {right.map((row) => renderSide(row.circuit, 'right'))}
      </div></div>
    );
  }

  function DirectoryPreview() {
    return (
      <section className="directoryPreviewClean">
        <div className="directoryPreviewHeader">
          <div><span>Generated directory</span><strong>{panel.name}</strong><small>{job.address}</small></div>
          {photoUrls?.breakerField ? <img src={photoUrls.breakerField} alt="Panel" /> : <div className="photoPlaceholder">Panel photo</div>}
        </div>
        <div className="directoryPreviewMeta"><b>Job #{job.id}</b><b>#1: {layout.label}</b><b>{panelMainAmps ? `${panelMainAmps}A Main` : 'Main: verify'}</b></div>
        <div className="directoryRows">
          {displayPairs.map((pair, i) => {
            const left = byCircuit[pair.left];
            const right = byCircuit[pair.right];
            const leftSource = left?.continuationOf ? byCircuit[left.continuationOf] : left;
            const rightSource = right?.continuationOf ? byCircuit[right.continuationOf] : right;
            const leftEmpty = leftSource?.breakerKind === 'empty';
            const rightEmpty = rightSource?.breakerKind === 'empty';
            return (
              <div className="directoryPreviewRow" key={i}>
                <span>{left ? left.circuit : ''}</span>
                <div className={`miniBreaker ${leftSource ? `family-${breakerFamily(leftSource)}` : ''}`}>{leftEmpty ? 'Empty' : leftSource?.amps ? `${leftSource.amps}A` : 'Verify'}</div>
                <div className="miniDescription leftText">{left?.continuationOf ? `${layout.bottomUp ? '↓' : '↑'} ${left.continuationOf}` : leftEmpty ? 'Open space' : leftSource?.description || 'Unlabeled'}</div>
                <div className="miniDescription rightText">{right?.continuationOf ? `${layout.bottomUp ? '↓' : '↑'} ${right.continuationOf}` : rightEmpty ? 'Open space' : rightSource?.description || 'Unlabeled'}</div>
                <div className={`miniBreaker ${rightSource ? `family-${breakerFamily(rightSource)}` : ''}`}>{rightEmpty ? 'Empty' : rightSource?.amps ? `${rightSource.amps}A` : 'Verify'}</div>
                <span>{right ? right.circuit : ''}</span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (!progress.ready) return <main className="content"><p role="status">Loading saved review progress…</p></main>;

  if (phase === 'ready') {
    return (
      <main className="content processPage">
        <p className="eyebrow">Panel processing</p>
        <h1>AI results are not available for this panel.</h1>
        <p className="lead">The server did not return an analysis result. You can still open a blank verification screen, but every circuit will be marked for review.</p>
        {gallery}
        <button className="primary large" onClick={runPreview}>Open Blank Verification</button>
        {savedRecord?.folderUrl && <a className="sharePointLink" href={savedRecord.folderUrl} target="_blank" rel="noreferrer">Open source photos in SharePoint</a>}
      </main>
    );
  }

  if (phase === 'final') {
    return (
      <main className="content finalDirectoryPage">
        <section className="directorySheet">
          <div className="directoryBrand"><strong>GEN3</strong><span>Electric & HVAC</span></div>
          <h2>Electrical Panel Directory</h2>
          <div className="directoryMeta">
            <div><span>Customer</span><strong>{job.customer}</strong></div><div><span>Job</span><strong>#{job.id}</strong></div>
            <div><span>Address</span><strong>{job.address}</strong></div><div><span>Panel</span><strong>{panel.name}</strong></div>
            <div><span>Manufacturer</span><strong>{panelManufacturer}</strong></div><div><span>Main</span><strong>{panelMainAmps ? `${panelMainAmps} A` : 'Verify'}</strong></div>
          </div>
          {DirectoryPreview()}
          <div className="directoryFooter">Verified by {finalReceipt?.verifiedBy || verifierName} · GEN3 Electric & HVAC · {finalReceipt?.verifiedAt ? new Date(finalReceipt.verifiedAt).toLocaleDateString() : new Date().toLocaleDateString()}</div>
        </section>
        {finalReceipt && <div className="finalSaved noPrint"><strong>Saved to SharePoint</strong><span>The corrected directory, verification details, and final PDF are now part of this panel’s permanent record.</span>{finalReceipt.indexWarnings?.length > 0 && <small>Files were saved. Some optional SharePoint index columns are not set up yet.</small>}</div>}
        {gallery}
        <div className="finalActions noPrint"><button className="secondary" onClick={() => setPhase('review')}>Back to Review</button>{finalReceipt?.finalPdfUrl ? <a className="primary" href={finalReceipt.finalPdfUrl} target="_blank" rel="noreferrer">Open Saved PDF</a> : <button className="primary" onClick={() => window.print()}>Print Copy</button>}</div>
        <button className="secondary noPrint printCopyButton" onClick={() => window.print()}>Print Another Copy</button>
        <div className="nextProcessCard noPrint"><span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for the load-calculation workflow.</p></div>
        <button className="secondary noPrint" onClick={onStartOver}>{returnLabel}</button>
      </main>
    );
  }

  return (
    <main className="content processPage panelReviewPage">
      <div className="panelReviewHeading"><h1>{panel.name || 'Panel review'}</h1><span>{panelManufacturer} · {rows.length} spaces</span></div>
      <div className="panelReviewToolbar">
        <PanelFlipControl value={numberingOrigin} onChange={setNumberingOrigin} />
        <button className="secondary" type="button" onClick={() => openReview(rows.find((row) => row.confidence === 'Review' && !row.continuationOf)?.circuit || rows[0]?.circuit)}>Review circuits ({rows.filter((row) => row.confidence === 'Review' && !row.continuationOf).length})</button>
        <button className="secondary" type="button" onClick={() => openReview()}>Panel warnings ({analysisWarnings.filter((warning) => !resolutions[warning]).length})</button>
        {gallery}
      </div>
      <div className="reviewSaveLine"><span role="status">{progress.status}</span><button type="button" onClick={progress.retry}>Save</button></div>
      <dialog ref={reviewDialog} className="panelReviewDialog" aria-labelledby="review-popup-title" onClose={() => setReviewTarget(null)}>
        <header className="reviewPopupHeader"><h2 id="review-popup-title">Review & correct</h2><button type="button" className="secondary" autoFocus onClick={closeReview}>Close</button></header>
        <div className="reviewPopupBody">
          {reviewTarget && <ReviewChecklist initialCircuit={reviewTarget.circuit} rows={rows} warnings={analysisWarnings} resolutions={resolutions} kinds={breakerKinds} onDone={closeReview}
            onResolve={(warning,note) => setResolutions((current) => ({ ...current, [warning]: { note: note.trim(), resolvedAt: new Date().toISOString() } }))}
            onReopen={(warning) => setResolutions((current) => { const next = { ...current }; delete next[warning]; return next; })}
            onPhoto={(name) => setOpenPhoto({ name, request: Date.now() })}
            onUpdate={updateCircuit} onKind={changeBreakerKind} onVerify={(circuit) => setRows(verifyCircuit(rows,circuit))} />}
        </div>
        <footer className="reviewPopupFooter" role="status">{progress.status}</footer>
      </dialog>
      {PhysicalPanel()}
      <div className="previewSectionTitle"><span>Live preview</span><strong>Finished directory</strong></div>
      {DirectoryPreview()}
      <section className="verificationSaveCard">
        <label>Verified by<input value={verifierName} maxLength={120} autoComplete="name" onChange={(event) => setVerifierName(event.target.value)} placeholder="Technician or reviewer name" /></label>
        <p>This name and the corrected breaker directory will be saved with the final PDF in SharePoint.</p>
        {finalizeError && <div className="finalizeError" role="alert">{finalizeError}</div>}
      </section>
      <div className="reviewActions"><button className="secondary" onClick={() => setPhase('ready')}>Back</button><button className="primary" disabled={finalizing} onClick={finalizeDirectory}>{finalizing ? 'Saving to SharePoint…' : 'Generate & Save Final Directory'}</button></div>
      <div className="nextProcessCard"><span>Planned next step</span><strong>Load Calculation</strong><p>The verified breaker map becomes the electrical inventory for the load calculation, reducing duplicate entry.</p></div>
    </main>
  );
}