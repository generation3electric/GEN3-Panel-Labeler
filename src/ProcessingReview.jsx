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
  const count = Math.max(12, Math.min(Number(spaces) || 20, 42));
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

  if (count >= 16) makeTwoPole(count % 2 === 0 ? count - 5 : count - 4, 30, 'Dryer');
  if (count >= 20) makeTwoPole(count % 2 === 0 ? count - 6 : count - 5, 50, 'Range');
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
    window.setTimeout(() => setPhase('review'), 900);
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

  function renderBreaker(circuit, side, compact = false) {
    const row = byCircuit[circuit];
    if (!row) return <div className={`panelSlot empty ${side}`} />;
    if (row.continuationOf) {
      const source = byCircuit[row.continuationOf];
      const family = source ? breakerFamily(source) : 'standard';
      return (
        <div className={`panelSlot continuation ${side} family-${family} ${source?.confidence === 'Review' ? 'needsReview' : ''} ${compact ? 'compactSlot' : ''}`}>
          <span className="slotNumber">{row.circuit}</span>
          <div className="breakerBody continuationBody"><strong>{row.amps}A</strong><small>2P</small></div>
          {!compact && <div className="continuationDescription">{row.description || 'Unlabeled'}</div>}
        </div>
      );
    }

    const kind = kindByValue[row.breakerKind] || kindByValue['1p_standard'];
    return (
      <div className={`panelSlot ${side} family-${kind.family} ${row.confidence === 'Review' ? 'needsReview' : ''} ${kind.poles === 2 ? 'twoPoleStart' : ''} ${compact ? 'compactSlot' : ''}`}>
        <span className="slotNumber">{row.circuit}</span>
        <div className="breakerBody">
          <select value={row.amps} onChange={(e) => updateCircuit(row.circuit, 'amps', e.target.value)} aria-label={`Circuit ${row.circuit} amps`}>
            {[15,20,25,30,40,50,60,70,80,90,100,125,150,175,200].map((amp) => <option key={amp} value={amp}>{amp}A</option>)}
          </select>
          {!compact && <span className="breakerKindShort">{kind.label}</span>}
        </div>
        {!compact && (
          <div className="breakerEdit">
            <select className="kindSelect" value={row.breakerKind} onChange={(e) => changeBreakerKind(row.circuit, e.target.value)}>
              {breakerKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <input list="common-circuit-names" placeholder="Search or type circuit description…" value={row.description} onChange={(e) => updateCircuit(row.circuit, 'description', e.target.value)} />
          </div>
        )}
        {compact && <div className="compactDescription">{row.description || 'Unlabeled'}</div>}
        {row.confidence === 'Review' && !compact && <span className="reviewBadge">Needs review</span>}
      </div>
    );
  }

  function DirectoryPreview({ final = false }) {
    return (
      <section className={`liveDirectory ${final ? 'finalPreview' : ''}`}>
        <div className="previewTop">
          <div><span className="miniEyebrow">Generated directory</span><strong>{panel.name}</strong><small>{job.address}</small></div>
          {photoUrls?.breakerField ? <img src={photoUrls.breakerField} alt="Panel" /> : <div className="photoPlaceholder">Panel photo</div>}
        </div>
        <div className="previewMeta"><span>Job #{job.id}</span><span>{panel.mainAmps ? `${panel.mainAmps}A Main` : 'Main: verify'}</span></div>
        <div className="miniPanel">
          {Array.from({ length: physicalRows }, (_, index) => {
            const odd = index * 2 + 1;
            const even = index * 2 + 2;
            return <React.Fragment key={index}>{renderBreaker(odd, 'left', true)}{renderBreaker(even, 'right', true)}</React.Fragment>;
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
        <p className="lead">The review screen follows the physical panel and keeps the finished directory visible while you edit it.</p>
        <div className="processSteps">
          <div><span>1</span><strong>Read breaker geometry</strong><small>Position, amperage, pole count and breaker family</small></div>
          <div><span>2</span><strong>Read labels when available</strong><small>Blank descriptions are allowed and easy to fill in</small></div>
          <div><span>3</span><strong>Human verification</strong><small>One breaker-type selector plus a larger description field</small></div>
          <div><span>4</span><strong>Generate the directory</strong><small>Panel image and breaker layout stay attached to the permanent record</small></div>
        </div>
        {photoUrls?.breakerField && <img className="processHeroPhoto" src={photoUrls.breakerField} alt="Breaker field" />}
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
          <DirectoryPreview final />
          <div className="directoryFooter">Verified panel directory · GEN3 Electric & HVAC · {new Date().toLocaleDateString()}</div>
        </section>
        <div className="finalActions noPrint"><button className="secondary" onClick={() => setPhase('review')}>Back to Review</button><button className="primary" onClick={() => window.print()}>Print / Save PDF</button></div>
        <div className="nextProcessCard noPrint"><span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for the load-calculation workflow.</p><button disabled>Coming next</button></div>
        <button className="secondary noPrint" onClick={onStartOver}>Start Another Panel</button>
      </main>
    );
  }

  return (
    <main className="content processPage panelReviewPage">
      <datalist id="common-circuit-names">{commonCircuits.map((name) => <option value={name} key={name} />)}</datalist>
      <p className="eyebrow">AI review preview</p>
      <h1>Verify the panel the way it is physically laid out.</h1>
      <div className="reviewNotice"><strong>{reviewCount} items need a closer look.</strong><span>Descriptions have extra room. Breaker type and pole count are combined into one selector.</span></div>
      <div className="reviewWorkspace">
        <div className="reviewEditor">
          <div className="panelLegend"><span><i className="legendStandard" />Standard</span><span><i className="legendAfci" />AFCI</span><span><i className="legendGfci" />GFCI / Dual</span><span><i className="legendSurge" />Surge</span><span><i className="legendReview" />Needs review</span></div>
          <div className="physicalPanel">
            <div className="panelColumnHeader leftHeader">ODD / LEFT</div><div className="centerHeader">AMP</div><div className="panelColumnHeader rightHeader">EVEN / RIGHT</div>
            {Array.from({ length: physicalRows }, (_, index) => {
              const odd = index * 2 + 1;
              const even = index * 2 + 2;
              return <React.Fragment key={index}>{renderBreaker(odd, 'left')}{renderBreaker(even, 'right')}</React.Fragment>;
            })}
          </div>
        </div>
        <aside className="directoryPreviewRail"><DirectoryPreview /></aside>
      </div>
      <div className="reviewActions"><button className="secondary" onClick={() => setPhase('ready')}>Back</button><button className="primary" onClick={() => setPhase('final')}>Generate Final Directory</button></div>
      <div className="nextProcessCard"><span>Planned next step</span><strong>Load Calculation</strong><p>The verified breaker map becomes the electrical inventory for the load calculation, reducing duplicate entry.</p></div>
    </main>
  );
}
