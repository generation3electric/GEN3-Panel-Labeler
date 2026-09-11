(() => {
  const STORAGE_KEY = 'gen3-panel-global-selected';
  const originalFetch = window.fetch.bind(window);

  function selectedRecord() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved?.job || !saved.selectedAt) return null;
      if (Date.now() - saved.selectedAt > 30 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return saved;
    } catch {
      return null;
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (!response.ok || !target.includes('/api/servicetitan/jobs?')) return response;
    const saved = selectedRecord();
    if (!saved?.job) return response;
    try {
      const data = await response.clone().json();
      const jobs = Array.isArray(data.jobs) ? data.jobs.slice() : [];
      if (!jobs.some((job) => job.locationId && job.locationId === saved.job.locationId)) jobs.unshift(saved.job);
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify({ ...data, jobs, count: jobs.length }), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };

  function buttonByText(text) {
    return [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
  }

  function nativeSet(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function tryResumeSelected() {
    const saved = selectedRecord();
    if (!saved?.autoResume) return;

    const start = buttonByText('Start Panel Label');
    if (start) {
      start.click();
      return;
    }

    const cards = [...document.querySelectorAll('.jobCard')];
    const match = cards.find((card) => {
      const text = card.textContent.toLowerCase();
      return text.includes(String(saved.job.address || '').toLowerCase()) ||
        (saved.job.locationId && text.includes(String(saved.job.locationId).toLowerCase()));
    });
    if (match) {
      match.click();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, autoResume: false }));
    }
  }

  function installSearch() {
    const normalSearch = document.querySelector('input.search');
    if (!normalSearch || document.querySelector('[data-global-st-search]')) return;

    const wrapper = document.createElement('div');
    wrapper.dataset.globalStSearch = 'true';
    wrapper.style.marginTop = '10px';
    wrapper.innerHTML = `
      <button type="button" class="secondary" data-global-toggle style="width:100%;min-height:46px">Search all ServiceTitan customers & locations</button>
      <div data-global-panel hidden style="margin-top:10px;padding:14px;border:1px solid #cdd8e6;border-radius:14px;background:#fff">
        <div style="font-weight:800;color:#173253;margin-bottom:6px">Search all ServiceTitan</div>
        <div style="font-size:14px;color:#66758a;line-height:1.4;margin-bottom:10px">Type part of an address, customer name, or location name. Partial addresses such as “1417 B” will return likely matches.</div>
        <input data-global-input class="search" autocomplete="off" placeholder="Try 1417 B, Broad St, or customer name" />
        <div data-global-status style="font-size:13px;color:#66758a;margin-top:8px"></div>
        <div data-global-results style="display:grid;gap:8px;margin-top:10px"></div>
      </div>`;
    normalSearch.insertAdjacentElement('afterend', wrapper);

    const toggle = wrapper.querySelector('[data-global-toggle]');
    const panel = wrapper.querySelector('[data-global-panel]');
    const input = wrapper.querySelector('[data-global-input]');
    const status = wrapper.querySelector('[data-global-status]');
    const results = wrapper.querySelector('[data-global-results]');
    let timer = null;
    let controller = null;

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.textContent = panel.hidden ? 'Search all ServiceTitan customers & locations' : 'Hide ServiceTitan search';
      if (!panel.hidden) input.focus();
    });

    input.addEventListener('input', () => {
      clearTimeout(timer);
      controller?.abort();
      results.innerHTML = '';
      const q = input.value.trim();
      if (q.length < 3) {
        status.textContent = q ? 'Type at least 3 characters.' : '';
        return;
      }
      status.textContent = 'Searching ServiceTitan…';
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const response = await originalFetch(`/api/servicetitan/location-search?q=${encodeURIComponent(q)}`, {
            headers: { Accept: 'application/json' }, signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Search failed.');
          status.textContent = data.results?.length
            ? `${data.results.length} likely match${data.results.length === 1 ? '' : 'es'}${data.incomplete ? ' · search limit reached' : ''}`
            : 'No matching ServiceTitan locations found.';
          for (const item of data.results || []) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'jobCard';
            button.style.width = '100%';
            button.style.textAlign = 'left';
            button.innerHTML = `<div class="jobMain"><strong></strong><span></span><small>Historical ServiceTitan location</small></div><div class="chev">›</div>`;
            button.querySelector('strong').textContent = item.customer || 'ServiceTitan customer';
            button.querySelector('span').textContent = item.address || `Location #${item.locationId}`;
            button.addEventListener('click', () => {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ job: item.job, selectedAt: Date.now(), autoResume: true }));
              window.location.reload();
            });
            results.appendChild(button);
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          status.textContent = error.message || 'ServiceTitan search failed.';
        }
      }, 325);
    });
  }

  const observer = new MutationObserver(() => {
    installSearch();
    tryResumeSelected();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', () => {
    installSearch();
    tryResumeSelected();
  });
})();
