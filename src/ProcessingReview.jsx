import React, { useMemo, useState } from 'react';
import './ProcessingReview.css';

const commonCircuits = [
  'Kitchen Receptacles','Kitchen Lighting','Dining Room','Living Room','Bedroom 1','Bedroom 2','Bedroom 3',
  'Bathroom','Bathroom GFCI','Laundry','Washer','Dryer','Dishwasher','Garbage Disposal','Microwave','Range',
  'Refrigerator','Basement','Garage','Exterior / GFCI','Smoke / CO','HVAC','Air Handler','Condenser','Heat Pump',
  'Water Heater','Boiler','Sump Pump','EV Charger','Pool','Spa','Subpanel','Surge Protector','Spare','Unknown'
];

const breakerKinds = [
  { value: '1p_standard', label: '1P Standard', poles: 1, family: 'standard' },
  { value: '2p_standard', label: '2P Standard', poles: 2, family: 'standard' },
  { value: '1p_afci', label: '1P AFCI', poles: 1, family: 'afci' },
  { value: '1p_gfci', label: '1P GFCI', poles: 1, family: 'gfci' },
  { value: '1p_dual', label: '1P Dual Function', poles: 1, family: 'dual' },
  { value: '1p_surge', label: '1P Surge', poles: 1, family: 'surge' },
  { value: '2p_surge', label: '2P Surge', poles: 2, family: 'surge' },
];

const kindByValue = Object.fromEntries(breakerKinds.map((kind) => [kind.value, kind]));

function buildRows(spaces) {
  const count = Math.max(12, Math.min(Number(spaces) || 30, 42));
  const result = Array.from({ length: count }, (_, index) => ({
    circuit: index + 1,
    amps: [15,20,20,20,15,20,15,15,20,20,15,20][index % 12],
    breakerKind: index === 4 ? '1p_afci' : index === 9 ? '1p_gfci' : '1p_standard',
    description: index % 3 === 0 ? '' : commonCircuits[index % 18],
    confidence: index % 7 === 0 ? 'Review' : 'High',
    continuationOf: null,
  }));

  const makeTwoPole = (circuit, amps, description, breakerKind = '2p_standard') => {
    const first = result.find((r) => r.circuit === circuit);
    const second = result.find((r) => r.circuit === circuit + 2);
    if (!first || !second) return;
    first.amps = amps;
    first.description = description;
    first.breakerKind = breakerKind;
    second.continuationOf = circuit;
    second.amps = amps;
    second.description = description;
    second.breakerKind = breakerKind;
    second.confidence = first.confidence;
  };

  if (count >= 26) makeTwoPole(24, 50, 'Range');
  if (count >= 27) makeTwoPole(25, 30, 'Dryer');
  return result;
}

function breakerFamily(row) {
  return kindByValue[row.breakerKind]?.family || 'standard';
}

export default function ProcessingReview({ job, panel, photoUrls, savedRecord, onStartOver }) {
  const [phase, setPhase] = useState('ready');
  const initialRows = useMemo(() => buildRows(panel.spaces), [panel.spaces]);
  const [rows, setRows] = useState(initialRows);

  function runPreview() {
    setPhase('processing');
    window.setTimeout(() => setPhase('review'), 700);
  }

  function updateCircuit(circuit, key, value) {
    setRows((current) => current.map((row) => {
      if (row.circuit === circuit || row.continuationOf === circuit) return { ...row, [key]: value };
      return row;
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
    if (!row) return null;
    if (row.continuationOf) return null;

    const kind = kindByValue[row.breakerKind] || kindByValue['1p_standard'];
    const rowIndex = side === 'left' ? Math.ceil(circuit / 2) : circuit / 2;
    const rowSpan = kind.poles === 2 ? 2 : 1;

    return (
      <React.Fragment key={`${side}-${circuit}`}>
        <div className={`panelDescription ${side} ${row.confidence === 'Review' ? 'needsReview' : ''}`} style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }}>
          <span className="circuitNumber">{circuit}</span>
          <input
            list="common-circuit-names"
            placeholder="Search or type circuit description…"
            value={row.description}
            onChange={(e) => updateCircuit(row.circuit, 'description', e.target.value)}
          />
          <select value={row.breakerKind} onChange={(e) => changeBreakerKind(row.circuit, e.target.value)}>
            {breakerKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {row.confidence === 'Review' && <span className="reviewFlag">Needs review</span>}
        </div>
        <div
          className={`breakerTile ${side} family-${kind.family} ${row.confidence === 'Review' ? 'needsReview' : ''} ${kind.poles === 2 ? 'twoPole' : ''}`}
          style={{ gridRow: `${rowIndex + 1} / span ${rowSpan}` }}
        >
          <select value={row.amps} onChange={(e) => updateCircuit(row.circuit, 'amps', e.target.value)} aria-label={`Circuit ${row.circuit} amps`}>
            {[15,20,25,30,40,50,60,70,80,90,100,125,150,175,200].map((amp) => <option key={amp} value={amp}>{amp}A</option>)}
          </select>
          <small>{kind.poles === 2 ? '2P' : kind.label.replace('1P ', '')}</small>
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
        <div className="panelGridHeader leftAmpHead">AMP</div>
        <div className="panelCenterLine" />
        <div className="panelGridHeader rightAmpHead">AMP</div>
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
        <div className="directoryPreviewMeta"><b>Job #{job.id}</b><b>{panel.mainAmps ? `${panel.mainAmps}A Main` : 'Main: verify'}</b></div>
        <div className="directoryRows">
          {Array.from({ length: physicalRows }, (_, i) => {
            const left = byCircuit[i * 2 + 1];
            const right = byCircuit[i * 2 + 2];
            const leftSource = left?.continuationOf ? byCircuit[left.continuationOf] : left;
            const rightSource = right?.continuationOf ? byCircuit[right.continuationOf] : right;
            return (
              <div className="directoryPreviewRow" key={i}>
                <span>{left ? left.circuit : ''}</span>
                <div className={`miniBreaker ${leftSource ? `family-${breakerFamily(leftSource)}` : ''}`}>{leftSource ? `${leftSource.amps}A` : ''}</div>
                <div className="miniDescription leftText">{left?.continuationOf ? '↳' : leftSource?.description || 'Unlabeled'}</div>
                <div className="miniDescription rightText">{right?.continuationOf ? '↳' : rightSource?.description || 'Unlabeled'}</div>
                <div className={`miniBreaker ${rightSource ? `family-${breakerFamily(rightSource)}` : ''}`}>{rightSource ? `${rightSource.amps}A` : ''}</div>
                <span>{right ? right.circuit : ''}</span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (phase === 'ready' || phase === 'processing') {
    return (
      <main className="content processPage">
        <p className="eyebrow">Panel processing</p>
        <h1>Turn the field record into a finished directory.</h1>
        <p className="lead">The review screen mirrors the physical panel without stacking controls on top of each other.</p>
        <button className="primary large" onClick={runPreview} disabled={phase === 'processing'}>{phase === 'processing' ? 'Processing photos…' : 'Process Panel Photos'}</button>
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
            <div><span>Manufacturer</span><strong>{panel.manufacturer}</strong></div><div><span>Main</span><strong>{panel.mainAmps ? `${panel.mainAmps} A` : 'Verify'}</strong></div>
          </div>
          <DirectoryPreview />
          <div className="directoryFooter">Verified panel directory · GEN3 Electric & HVAC · {new Date().toLocaleDateString()}</div>
        </section>
        <div className="finalActions noPrint"><button className="secondary" onClick={() => setPhase('review')}>Back to Review</button><button className="primary" onClick={() => window.print()}>Print / Save PDF</button></div>
        <div className="nextProcessCard noPrint"><span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for the load-calculation workflow.</p></div>
        <button className="secondary noPrint" onClick={onStartOver}>Start Another Panel</button>
      </main>
    );
  }

  return (
    <main className="content processPage panelReviewPage">
      <datalist id="common-circuit-names">{commonCircuits.map((name) => <option value={name} key={name} />)}</datalist>
      <p className="eyebrow">AI review preview</p>
      <h1>Verify the panel the way it is physically laid out.</h1>
      <div className="reviewNotice"><strong>{reviewCount} items need a closer look.</strong><span>One clean row system. No controls overlap the breaker column.</span></div>
      <div className="panelLegend"><span><i className="legendStandard" />Standard</span><span><i className="legendAfci" />AFCI</span><span><i className="legendGfci" />GFCI / Dual</span><span><i className="legendSurge" />Surge</span><span><i className="legendReview" />Needs review</span></div>
      <PhysicalPanel />
      <div className="previewSectionTitle"><span>Live preview</span><strong>Finished directory</strong></div>
      <DirectoryPreview />
      <div className="reviewActions"><button className="secondary" onClick={() => setPhase('ready')}>Back</button><button className="primary" onClick={() => setPhase('final')}>Generate Final Directory</button></div>
      <div className="nextProcessCard"><span>Planned next step</span><strong>Load Calculation</strong><p>The verified breaker map becomes the electrical inventory for the load calculation, reducing duplicate entry.</p></div>
    </main>
  );
}
