import React, { useMemo, useState } from 'react';

const demoNames = [
  'Kitchen Receptacles', 'Dining Room', 'Dishwasher', 'Garbage Disposal',
  'Living Room', 'Microwave', 'Bedroom 1', 'Bedroom 2',
  'Bathroom', 'Laundry', 'Basement', 'Exterior / GFCI',
  'HVAC', 'Water Heater', 'Range', 'Dryer',
];

function buildRows(spaces) {
  const count = Math.max(12, Math.min(Number(spaces) || 20, 42));
  return Array.from({ length: count }, (_, index) => ({
    circuit: index + 1,
    amps: [15, 20, 20, 20, 15, 20, 15, 15, 20, 20, 15, 20][index % 12],
    poles: index > count - 5 ? 2 : 1,
    description: demoNames[index % demoNames.length],
    confidence: index % 7 === 0 ? 'Review' : 'High',
  }));
}

export default function ProcessingReview({ job, panel, photoUrls, savedRecord, onStartOver }) {
  const [phase, setPhase] = useState('ready');
  const initialRows = useMemo(() => buildRows(panel.spaces), [panel.spaces]);
  const [rows, setRows] = useState(initialRows);

  function runPreview() {
    setPhase('processing');
    window.setTimeout(() => setPhase('review'), 1100);
  }

  function updateRow(index, key, value) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }

  function printDirectory() {
    setPhase('final');
    window.setTimeout(() => window.print(), 100);
  }

  if (phase === 'ready' || phase === 'processing') {
    return (
      <main className="content processPage">
        <p className="eyebrow">Panel processing</p>
        <h1>Turn the field record into a finished directory.</h1>
        <p className="lead">This is the first processing-screen prototype. It uses a sample extraction so we can test the review and finished-document workflow before connecting the vision model to the saved SharePoint photos.</p>
        <div className="processSteps">
          <div><span>1</span><strong>Read panel photos</strong><small>Breaker positions, ratings and directory text</small></div>
          <div><span>2</span><strong>Flag uncertain items</strong><small>Only questionable circuits need attention</small></div>
          <div><span>3</span><strong>Verify the directory</strong><small>Edit descriptions and breaker ratings</small></div>
          <div><span>4</span><strong>Create final record</strong><small>Printable directory + permanent digital copy</small></div>
        </div>
        {photoUrls?.breakerField && <img className="processHeroPhoto" src={photoUrls.breakerField} alt="Breaker field" />}
        <button className="primary large" onClick={runPreview} disabled={phase === 'processing'}>{phase === 'processing' ? 'Processing photos…' : 'Process Panel Photos'}</button>
        {savedRecord?.folderUrl && <a className="sharePointLink" href={savedRecord.folderUrl} target="_blank" rel="noreferrer">Open source photos in SharePoint</a>}
      </main>
    );
  }

  if (phase === 'final') {
    const left = rows.filter((r) => r.circuit % 2 === 1);
    const right = rows.filter((r) => r.circuit % 2 === 0);
    return (
      <main className="content finalDirectoryPage">
        <section className="directorySheet">
          <div className="directoryBrand"><strong>GEN3</strong><span>Electric & HVAC</span></div>
          <h2>Electrical Panel Directory</h2>
          <div className="directoryMeta">
            <div><span>Customer</span><strong>{job.customer}</strong></div>
            <div><span>Job</span><strong>#{job.id}</strong></div>
            <div><span>Address</span><strong>{job.address}</strong></div>
            <div><span>Panel</span><strong>{panel.name}</strong></div>
            <div><span>Manufacturer</span><strong>{panel.manufacturer}</strong></div>
            <div><span>Main</span><strong>{panel.mainAmps ? `${panel.mainAmps} A` : 'Verify'}</strong></div>
          </div>
          <div className="directoryColumns">
            {[left, right].map((column, columnIndex) => (
              <div className="directoryColumn" key={columnIndex}>
                {column.map((row) => (
                  <div className="directoryLine" key={row.circuit}>
                    <b>{row.circuit}</b><span>{row.description}</span><em>{row.amps}A{row.poles === 2 ? ' 2P' : ''}</em>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="directoryFooter">Verified panel directory · GEN3 Electric & HVAC · {new Date().toLocaleDateString()}</div>
        </section>
        <div className="finalActions noPrint">
          <button className="secondary" onClick={() => setPhase('review')}>Back to Review</button>
          <button className="primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
        <div className="nextProcessCard noPrint">
          <span>Next process</span><strong>Panel Load Calculation</strong><p>Use the verified breakers, appliance circuits and service size as the starting point for an NEC load-calculation workflow.</p><button disabled>Coming next</button>
        </div>
        <button className="secondary noPrint" onClick={onStartOver}>Start Another Panel</button>
      </main>
    );
  }

  return (
    <main className="content processPage">
      <p className="eyebrow">AI review preview</p>
      <h1>Verify what was read from the panel.</h1>
      <div className="reviewNotice"><strong>{rows.filter((r) => r.confidence === 'Review').length} circuits need a closer look.</strong><span>Everything is editable before the final label is generated.</span></div>
      <div className="breakerReviewTable">
        <div className="breakerReviewHead"><span>Circuit</span><span>Amps</span><span>Description</span></div>
        {rows.map((row, index) => (
          <div className={`breakerReviewRow ${row.confidence === 'Review' ? 'needsReview' : ''}`} key={row.circuit}>
            <div className="circuitNumber"><b>{row.circuit}</b><small>{row.poles === 2 ? '2 pole' : '1 pole'}</small></div>
            <input aria-label={`Circuit ${row.circuit} amps`} inputMode="numeric" value={row.amps} onChange={(e) => updateRow(index, 'amps', e.target.value)} />
            <input aria-label={`Circuit ${row.circuit} description`} value={row.description} onChange={(e) => updateRow(index, 'description', e.target.value)} />
            {row.confidence === 'Review' && <span className="reviewBadge">Check</span>}
          </div>
        ))}
      </div>
      <div className="reviewActions">
        <button className="secondary" onClick={() => setPhase('ready')}>Back</button>
        <button className="primary" onClick={printDirectory}>Generate Final Directory</button>
      </div>
      <div className="nextProcessCard">
        <span>Planned next step</span><strong>Load Calculation</strong><p>After the breaker directory is verified, this same record can feed a panel/service load calculation instead of asking the technician to re-enter the electrical loads.</p>
      </div>
    </main>
  );
}
