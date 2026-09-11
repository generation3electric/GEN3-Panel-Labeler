import React, { useMemo, useState } from 'react';
import './ProcessingReview.css';
import { buildRowsFromAnalysis, getAIAnalysis } from './panelAnalysis.js';

const commonCircuits = [
  'Kitchen','Kitchen Receptacles','Kitchen Lighting','Kitchen Counter','Dining Room','Dining Room Lights','Living Room','Living Room Lights',
  'Bedroom 1','Bedroom 2','Bedroom 3','Bedroom Lights','Bathroom','Bathroom Lights','Bathroom GFCI','Laundry','Washer','Dryer',
  'Dishwasher','Garbage Disposal','Microwave','Range','Refrigerator','Basement','Basement Lights','Garage','Garage Receptacles',
  'Exterior','Exterior Lights','Exterior / GFCI','Smoke / CO','HVAC','Air Handler','Condenser','Heat Pump','Water Heater','Boiler',
  'Sump Pump','EV Charger','Pool','Spa','Hot Tub','Subpanel','Surge Protector','Lighting','Receptacles','Spare','Unknown'
];

const breakerKinds = [
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
  const normalized = useMemo(() => buildRowsFromAnalysis(panel, analysis), [panel, analysis]);
  const previousFinalization = savedRecord?.finalization || savedRecord?.receipt?.finalization || null;
  const [phase, setPhase] = useState(() => (previousFinalization ? 'final' : analysis ? 'review' : 'ready'));
  const [rows, setRows] = useState(() => previousFinalization?.rows || normalized.rows);
  const [labelQueries, setLabelQueries] = useState({});
  const [verifierName, setVerifierName] = useState(() => previousFinalization?.verifiedBy || localStorage.getItem('gen3-panel-verifier-name') || '');
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [finalReceipt, setFinalReceipt] = useState(previousFinalization);
  const analysisWarnings = [...(Array.isArray(analysis?.warnings) ? analysis.warnings : []), ...normalized.warnings];
  const analyzedPanel = analysis?.panel || {};
  const panelManufacturer = panel.manufacturer && panel.manufacturer !== 'Unknown' ? panel.manufacturer : analyzedPanel.manufacturer || 'Verify';
  const panelMainAmps = panel.mainAmps || analyzedPanel.mainAmps || null;

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
          panel: { ...panel, manufacturer: panelManufacturer, mainAmps: panelMainAmps },
          rows,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The final directory could not be saved.');
      const saved = { ...result, rows };
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
      if (row.circuit === circuit || row.continuationOf === circuit) return { ...row, [key]: value };
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
      return { ...row, description: next.slice(0, 280) };
    }));
  }

  function changeBreakerKind(circuit, breakerKind) {
    setRows((current) => {
      const target = current.find((r) => r.circuit === circuit);
      if (!target || target.continuationOf) return current;
      const next = current.find((r) => r.circuit === circuit + 2);
      const poles = kindByValue[breakerKind]?.poles || 1;
      return current.map((row) => {
        if (row.circuit === circuit) return { ...row, breakerKind };
        if (poles === 2 && next && row.circuit === next.circuit) {
          return { ...row, continuationOf: circuit, amps: target.amps, description: target.description, breakerKind, confidence: target.confidence };
        }
        if (poles === 1 && row.continuationOf === circuit) {
          return { ...row, continuationOf: null, description: '', breakerKind: '1p_standard', confidence: 'Review' };
        }
        return row;
      });
    });
  }

  const byCircuit = Object.fromEntries(rows.map((row) => [row.circuit, row]));
  const physicalRows = Math.ceil(rows.length / 2);
  const reviewCount = rows.filter((r) => r.confidence === 'Review' && !r.continuationOf).length;

  function renderSide(circuit, side) {
    const row = byCircuit[circuit];
    if (!row || row.continuationOf) return null;

    const kind = kindByValue[row.breakerKind] || kindByValue['1p_unknown'];
    const rowIndex = side === 'left' ? Math.ceil(circuit / 2) : circuit / 2;
    const rowSpan = kind.poles === 2 ? 2 : 1;
    const query = labelQueries[row.circuit] || '';
    const filteredLabels = commonCircuits.filter((name) => name.toLowerCase().includes(query.toLowerCase())).slice(0, 14);

    return (
      <React.Fragment key={`${side}-${circuit}`}>
        <div className={`panelDescription ${side} ${row.confidence === 'Review' ? 'needsReview' : ''}`} style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }} title={row.notes ? `AI note: ${row.notes}` : undefined}>
          <span className="circuitNumber">{circuit}</span>
          <textarea
            className="circuitDescriptionInput"
            placeholder="Search or type circuit description…"
            value={row.description}
            maxLength={280}
            rows={rowSpan === 2 ? 5 : 3}
            style={{ fontSize: descriptionFontSize(row.description) }}
            onChange={(e) => updateCircuit(row.circuit, 'description', e.target.value)}
            aria-label={`Circuit ${row.circuit} description`}
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
          {row.confidence === 'Review' && <span className="reviewFlag" title={row.notes || undefined}>{row.notes ? 'Review AI note' : 'Needs review'}</span>}
        </div>
        <div
          className={`breakerTile ${side} family-${kind.family} ${row.confidence === 'Review' ? 'needsReview' : ''} ${kind.poles === 2 ? 'twoPole' : ''}`}
          style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }}
        >
          <select className="ampSelect" value={row.amps ?? ''} onChange={(e) => updateCircuit(row.circuit, 'amps', e.target.value ? Number(e.target.value) : null)} aria-label={`Circuit ${row.circuit} amps`}>
            <option value="">Verify amps</option>
            {[...new Set([15,20,25,30,40,50,60,70,80,90,100,125,150,175,200, row.amps].filter(Boolean))].sort((a, b) => a - b).map((amp) => <option key={amp} value={amp}>{amp}A</option>)}
          </select>
          <select className="breakerKindSelect" value={row.breakerKind} onChange={(e) => changeBreakerKind(row.circuit, e.target.value)} aria-label={`Circuit ${row.circuit} breaker type`}>
            {breakerKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      </React.Fragment>
    );
  }

  function PhysicalPanel() {
    const odd = rows.filter((r) => r.circuit % 2 === 1 && !r.continuationOf);
    const even = rows.filter((r) => r.circuit % 2 === 0 && !r.continuationOf);
    return (
      <div className="cleanPanelGrid" style={{ '--panel-rows': physicalRows }}>
        <div className="panelGridHeader leftDescHead">ODD / LEFT</div>
        <div className="panelGridHeader leftAmpHead">BREAKER</div>
        <div className="panelCenterLine" />
        <div className="panelGridHeader rightAmpHead">BREAKER</div>
        <div className="panelGridHeader rightDescHead">EVEN / RIGHT</div>
        {odd.map((row) => renderSide(row.circuit, 'left'))}
        {even.map((row) => renderSide(row.circuit, 'right'))}
      </div>
    );
  }

  function DirectoryPreview() {
    return (
      <section className="directoryPreviewClean">
        <div className="directoryPreviewHeader">
          <div><span>Generated directory</span><strong>{panel.name}</strong><small>{job.address}</small></div>
          {photoUrls?.breakerField ? <img src={photoUrls.breakerField} alt="Panel" /> : <div className="photoPlaceholder">Panel photo</div>}
        </div>
        <div className="directoryPreviewMeta"><b>Job #{job.id}</b><b>{panelMainAmps ? `${panelMainAmps}A Main` : 'Main: verify'}</b></div>
        <div className="directoryRows">
          {Array.from({ length: physicalRows }, (_, i) => {
            const left = byCircuit[i * 2 + 1];
            const right = byCircuit[i * 2 + 2];
            const leftSource = left?.continuationOf ? byCircuit[left.continuationOf] : left;
            const rightSource = right?.continuationOf ? byCircuit[right.continuationOf] : right;
            return (
              <div className="directoryPreviewRow" key={i}>
                <span>{left ? left.circuit : ''}</span>
                <div className={`miniBreaker ${leftSource ? `family-${breakerFamily(leftSource)}` : ''}`}>{leftSource?.amps ? `${leftSource.amps}A` : 'Verify'}</div>
                <div className="miniDescription leftText">{left?.continuationOf ? '↳' : leftSource?.description || 'Unlabeled'}</div>
                <div className="miniDescription rightText">{right?.continuationOf ? '↳' : rightSource?.description || 'Unlabeled'}</div>
                <div className={`miniBreaker ${rightSource ? `family-${breakerFamily(rightSource)}` : ''}`}>{rightSource?.amps ? `${rightSource.amps}A` : 'Verify'}</div>
                <span>{right ? right.circuit : ''}</span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (phase === 'ready') {
    return (
      <main className="content processPage">
        <p className="eyebrow">Panel processing</p>
        <h1>AI results are not available for this panel.</h1>
        <p className="lead">The server did not return an analysis result. You can still open a blank verification screen, but every circuit will be marked for review.</p>
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
        <div className="finalActions noPrint"><button className="secondary" onClick={() => setPhase('review')}>Back to Review</button>{finalReceipt?.finalPdfUrl ? <a className="primary" href={finalReceipt.finalPdfUrl} target="_blank" rel="noreferrer">Open Saved PDF</a> : <button className="primary" onClick={() => window.print()}>Print Copy</button>}</div>
        <button className="secondary noPrint printCopyButton" onClick={() => window.print()}>Print Another Copy</button>
        <div className="nextProcessCard noPrint"><span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for the load-calculation workflow.</p></div>
        <button className="secondary noPrint" onClick={onStartOver}>{returnLabel}</button>
      </main>
    );
  }

  return (
    <main className="content processPage panelReviewPage">
      <p className="eyebrow">AI verification</p>
      <h1>Verify the panel the way it is physically laid out.</h1>
      <div className="analysisSummary">
        <strong>AI result loaded</strong>
        <span>{panelManufacturer} · {panelMainAmps ? `${panelMainAmps}A main` : 'main amps need verification'} · {rows.length} spaces{Number.isFinite(Number(analyzedPanel.confidence)) ? ` · ${Math.round(Number(analyzedPanel.confidence) * 100)}% panel confidence` : ''}</span>
        {savedRecord?.aiModel && <small>Analyzed by {savedRecord.aiModel}</small>}
      </div>
      <div className="reviewNotice"><strong>{reviewCount} items need a closer look.</strong><span>Yellow items are low-confidence, incomplete, or missing from the AI reading. Correct them before generating the directory.</span></div>
      {analysisWarnings.length > 0 && <div className="analysisWarnings"><strong>AI warnings</strong><ul>{analysisWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
      <div className="panelLegend"><span><i className="legendStandard" />Standard</span><span><i className="legendAfci" />AFCI</span><span><i className="legendGfci" />GFCI / Dual</span><span><i className="legendSurge" />Surge</span><span><i className="legendReview" />Needs review</span></div>
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
