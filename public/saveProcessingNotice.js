(() => {
  const SLOW_DELAY_MS = 30000;
  let slowTimer = null;
  let active = false;

  const style = document.createElement('style');
  style.textContent = `
    .gen3-processing-overlay[hidden] {
      display: none !important;
    }
    .gen3-processing-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(7, 24, 43, 0.72);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .gen3-processing-card {
      width: min(440px, 100%);
      border-radius: 18px;
      background: #fff;
      color: #0b2748;
      padding: 28px 24px;
      box-shadow: 0 18px 50px rgba(0,0,0,.28);
      text-align: center;
    }
    .gen3-processing-spinner {
      width: 44px;
      height: 44px;
      margin: 0 auto 18px;
      border-radius: 50%;
      border: 5px solid rgba(11,39,72,.16);
      border-top-color: #0b2748;
      animation: gen3-spin .85s linear infinite;
    }
    .gen3-processing-card h2 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.2;
    }
    .gen3-processing-card p {
      margin: 0;
      font-size: 15px;
      line-height: 1.5;
      color: #4b5f73;
    }
    @keyframes gen3-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .gen3-processing-spinner { animation-duration: 1.8s; }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'gen3-processing-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="gen3-processing-card">
      <div class="gen3-processing-spinner" aria-hidden="true"></div>
      <h2>Analyzing panel photos…</h2>
      <p>This can take up to a minute. Please keep this screen open.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const title = overlay.querySelector('h2');
  const message = overlay.querySelector('p');

  function show() {
    if (active) return;
    active = true;
    title.textContent = 'Analyzing panel photos…';
    message.textContent = 'This can take up to a minute. Please keep this screen open.';
    overlay.hidden = false;
    slowTimer = window.setTimeout(() => {
      if (!active) return;
      title.textContent = 'Still working…';
      message.textContent = 'Larger panels or multiple photos can take a little longer.';
    }, SLOW_DELAY_MS);
  }

  function hide() {
    if (!active) return;
    active = false;
    overlay.hidden = true;
    if (slowTimer) window.clearTimeout(slowTimer);
    slowTimer = null;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.sendButton');
    if (!button || button.disabled) return;
    if (!button.textContent.includes('Save, Upload & Build Label')) return;
    show();
  }, true);

  const observer = new MutationObserver(() => {
    if (!active) return;
    const sendButton = document.querySelector('.sendButton');
    const stillSaving = sendButton?.disabled && /Saving|Analyzing/i.test(sendButton.textContent || '');
    if (!stillSaving) hide();
  });

  observer.observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
})();
