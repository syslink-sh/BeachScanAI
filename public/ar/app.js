(() => {
  const form = document.getElementById('analyze-form');
  const pageScan = document.getElementById('page-scan');
  const pageSettings = document.getElementById('page-settings');
  const tabScan = document.getElementById('tab-scan');
  const tabSettings = document.getElementById('tab-settings');
  const fileInput = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const chooseBtn = document.getElementById('choose-files');
  const fileCount = document.getElementById('file-count');
  const concurrencyInput = document.getElementById('concurrency');
  const minConfInput = document.getElementById('min-confidence');
  const rtMinConf = document.getElementById('rt-min-confidence');
  const rtMinConfValue = document.getElementById('rt-min-confidence-value');
  const statusEl = document.getElementById('status');
  const gallery = document.getElementById('gallery');
  const summary = document.getElementById('summary');
  const stats = document.getElementById('stats');
  const modal = document.getElementById('modal');
  const modalClose = document.getElementById('modal-close');
  const modalImage = document.getElementById('modal-image');
  const modalCanvas = document.getElementById('modal-canvas');
  const modalDetails = document.getElementById('modal-details');
  const settingsSaveBtn = document.getElementById('settings-save');
  const settingsStatus = document.getElementById('settings-status');
  const setCleanMax = document.getElementById('set-clean-max');
  const setMediumMax = document.getElementById('set-medium-max');
  const setPenalty = document.getElementById('set-penalty');
  const setOverallClean = document.getElementById('set-overall-clean');
  const setOverallMedium = document.getElementById('set-overall-medium');
  const setDrawBoxes = document.getElementById('set-draw-boxes');
  const setDefaultMinConf = document.getElementById('set-default-minconf');
  const setDefaultConcurrency = document.getElementById('set-default-concurrency');
  let previewUrls = []; 
  let lastResults = null;
  let viewResults = null; 
  const SETTINGS_KEY = 'beachscan_settings_v1';
  const DEFAULT_SETTINGS = {
    thresholds: { cleanMax: 1, mediumMax: 5 },
    perItemPenalty: 10, 
    overall: { cleanMinPercent: 80, mediumMinPercent: 40 },
    drawBoxes: true,
    defaultMinConfidence: 0.10,
    defaultConcurrency: 5
  };
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const s = JSON.parse(raw);
      return normalizeSettings({ ...DEFAULT_SETTINGS, ...s });
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
  }
  function normalizeSettings(s) {
    const cleanMax = clamp(parseInt(s?.thresholds?.cleanMax ?? 1, 10) || 0, 0, 100);
    const mediumMax = Math.max(cleanMax, clamp(parseInt(s?.thresholds?.mediumMax ?? 5, 10) || 0, 0, 100));
    const perItemPenalty = clamp(parseFloat(s?.perItemPenalty ?? 10) || 0, 0, 100);
    const cleanMinPercent = clamp(parseInt(s?.overall?.cleanMinPercent ?? 80, 10) || 0, 0, 100);
    const mediumMinPercent = clamp(parseInt(s?.overall?.mediumMinPercent ?? 40, 10) || 0, 0, cleanMinPercent);
    const drawBoxes = Boolean(s?.drawBoxes !== false);
    const defaultMinConfidence = clamp(parseFloat(s?.defaultMinConfidence ?? 0.10) || 0, 0, 1);
    const defaultConcurrency = clamp(parseInt(s?.defaultConcurrency ?? 5, 10) || 1, 1, 20);
    return {
      thresholds: { cleanMax, mediumMax },
      perItemPenalty,
      overall: { cleanMinPercent, mediumMinPercent },
      drawBoxes,
      defaultMinConfidence,
      defaultConcurrency
    };
  }
  function updateClassificationPreview() {
    const cleanMax = parseInt(setCleanMax.value, 10) || 0;
    const mediumMax = parseInt(setMediumMax.value, 10) || 0;
    const previewCleanMax = document.getElementById('preview-clean-max');
    const previewCleanMaxPlus = document.getElementById('preview-clean-max-plus');
    const previewMediumMax = document.getElementById('preview-medium-max');
    const previewMediumMaxPlus = document.getElementById('preview-medium-max-plus');
    if (previewCleanMax) previewCleanMax.textContent = cleanMax;
    if (previewCleanMaxPlus) previewCleanMaxPlus.textContent = cleanMax + 1;
    if (previewMediumMax) previewMediumMax.textContent = mediumMax;
    if (previewMediumMaxPlus) previewMediumMaxPlus.textContent = mediumMax + 1;
  }
  function applySettingsToUI() {
    setCleanMax.value = String(SETTINGS.thresholds.cleanMax);
    setMediumMax.value = String(SETTINGS.thresholds.mediumMax);
    setPenalty.value = String(SETTINGS.perItemPenalty);
    setOverallClean.value = String(SETTINGS.overall.cleanMinPercent);
    setOverallMedium.value = String(SETTINGS.overall.mediumMinPercent);
    setDrawBoxes.checked = SETTINGS.drawBoxes;
    setDefaultMinConf.value = String(SETTINGS.defaultMinConfidence.toFixed(2));
    setDefaultConcurrency.value = String(SETTINGS.defaultConcurrency);
    if (minConfInput) minConfInput.value = String(SETTINGS.defaultMinConfidence);
    if (concurrencyInput) concurrencyInput.value = String(SETTINGS.defaultConcurrency);
    setRtMinConfidence(SETTINGS.defaultMinConfidence);
    updateClassificationPreview();
  }
  function collectSettingsFromUI() {
    return normalizeSettings({
      thresholds: {
        cleanMax: parseInt(setCleanMax.value, 10),
        mediumMax: parseInt(setMediumMax.value, 10)
      },
      perItemPenalty: parseFloat(setPenalty.value),
      overall: {
        cleanMinPercent: parseInt(setOverallClean.value, 10),
        mediumMinPercent: parseInt(setOverallMedium.value, 10)
      },
      drawBoxes: !!setDrawBoxes.checked,
      defaultMinConfidence: parseFloat(setDefaultMinConf.value),
      defaultConcurrency: parseInt(setDefaultConcurrency.value, 10)
    });
  }
  function labelClass(label) {
    const l = String(label || '').toLowerCase();
    if (l.includes('dirty') && !l.includes('medium')) return 'dirty';
    if (l.includes('medium')) return 'medium';
    return 'clean';
  }
  async function onSubmit(e) {
    e.preventDefault();
    gallery.innerHTML = '';
    summary.classList.add('hidden');
    stats.classList.add('hidden');
    previewUrls = [];
    lastResults = null;
    viewResults = null;
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      statusEl.textContent = 'يرجى رفع بعض الصور.';
      return;
    }
    files.forEach(f => previewUrls.push(URL.createObjectURL(f)));
    const fd = new FormData();
    const concurrency = parseInt(concurrencyInput.value, 10) || 5;
    fd.append('concurrency', String(concurrency));
    const minConf = parseFloat(minConfInput.value);
    if (!Number.isNaN(minConf)) fd.append('minConfidence', String(minConf));
    fd.append('settings', JSON.stringify(SETTINGS));
    files.forEach(f => fd.append('files', f));
    statusEl.textContent = 'جاري التحليل... قد يستغرق وقتاً طويلاً للعديد من الصور';
    try {
      const resp = await fetch('/analyze', {
        method: 'POST',
        body: fd
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || ('HTTP ' + resp.status));
      }
      const data = await resp.json();
      lastResults = data;
      const serverMin = typeof data.summary?.minConfidence === 'number' ? data.summary.minConfidence : parseFloat(minConfInput.value) || 0.5;
      setRtMinConfidence(serverMin);
      viewResults = deriveResultsForMinConf(data.results || [], getRtMinConfidence(), SETTINGS);
      const derivedSummary = deriveSummary(viewResults, data.summary || {}, SETTINGS);
      renderSummary(derivedSummary);
      renderStats(derivedSummary, viewResults);
      renderGallery(viewResults);
      statusEl.textContent = 'تم';
    } catch (err) {
      statusEl.textContent = 'خطأ: ' + (err.message || String(err));
    }
  }
  function getRtMinConfidence() {
    const v = parseFloat(rtMinConf.value);
    return Number.isFinite(v) ? v : 0.5;
  }
  function setRtMinConfidence(v) {
    const clamped = Math.min(1, Math.max(0, v));
    rtMinConf.value = String(clamped);
    rtMinConfValue.textContent = clamped.toFixed(2);
  }
  function renderSummary(s) {
    if (!s) return;
    summary.classList.remove('hidden');
    const duration = s.durationMs ? `${(s.durationMs/1000).toFixed(1)}s` : '—';
    summary.innerHTML = `
      <strong>نظرة عامة</strong> · ${new Date(s.startedAt || Date.now()).toLocaleString()} · المدة ${duration}
    `;
  }
  function renderStats(s, results) {
    stats.classList.remove('hidden');
    const processed = s.processed ?? (results.filter(r => !r.error).length);
    const failed = s.failed ?? (results.length - processed);
    const clean = s.countClean ?? results.filter(r => (r.imageLabel||'').toLowerCase().includes('clean') && !(r.imageLabel||'').toLowerCase().includes('medium')).length;
    const medium = s.countMedium ?? results.filter(r => (r.imageLabel||'').toLowerCase().includes('medium')).length;
    const dirty = s.countDirty ?? results.filter(r => (r.imageLabel||'').toLowerCase().includes('dirty') && !(r.imageLabel||'').toLowerCase().includes('medium')).length;
    const avgWaste = s.averageWastePerImage ?? (processed ? (results.filter(r=>!r.error).reduce((a,b)=>a+(b.wasteCount||0),0)/processed) : 0);
    document.getElementById('stat-cleanliness').textContent = `${s.averageCleanlinessPercent ?? '–'}%`;
    document.getElementById('stat-overall-label').textContent = s.overallLabel ?? '—';
    document.getElementById('stat-images').textContent = `${s.totalImages ?? results.length}`;
    document.getElementById('stat-processed').textContent = `تم معالجة ${processed} · فشل ${failed}`;
    document.getElementById('stat-waste').textContent = `${s.totalWasteItems ?? 0}`;
    document.getElementById('stat-avg-waste').textContent = `متوسط ${avgWaste.toFixed(2)} لكل صورة`;
    const conf = s.averageConfidencePercent != null ? `${s.averageConfidencePercent}% متوسط الثقة` : 'متوسط الثقة —';
    const minC = typeof s.minConfidence === 'number' ? ` · حد أدنى الثقة ${Math.round(s.minConfidence*100)}%` : '';
    document.getElementById('stat-breakdown').textContent = `نظيف ${clean} · متوسط ${medium} · متسخ ${dirty}`;
    document.getElementById('stat-conf').textContent = conf + minC;
  }
  function renderGallery(results) {
    gallery.innerHTML = '';
    results.forEach((r, idx) => {
      const src = previewUrls[r.index] || previewUrls[idx];
      const div = document.createElement('div');
      div.className = 'card';
      div.dataset.index = String(r.index);
      const badge = r.error ? 'خطأ' : `${r.cleanlinessPercent ?? '—'}% نظيف`;
      div.innerHTML = `
        <div style="position:relative">
          <span class="badge">${badge}</span>
          <img class="thumb" src="${src}" alt="Beach image ${r.index + 1}" />
        </div>
        <div class="card-body">
          ${r.error ? `<span class="label dirty">خطأ</span>` : `<span class="label ${labelClass(r.imageLabel)}">${r.imageLabel}</span>`}
          <span class="muted">${r.error ? r.error : `${r.wasteCount} عنصر`}</span>
        </div>
      `;
      div.addEventListener('click', () => openModal(r, src));
      gallery.appendChild(div);
    });
  }
  function deriveResultsForMinConf(results, minC, settings) {
    const s = normalizeSettings(settings || SETTINGS);
    return (results || []).map((r) => {
      if (r.error) return r;
      const boxes = Array.isArray(r.boxes) ? r.boxes.filter(b => typeof b.confidence !== 'number' || b.confidence >= minC) : [];
      const wasteCount = boxes.length;
      const cleanlinessPercent = clamp(100 - wasteCount * s.perItemPenalty, 0, 100);
      const imageLabel = classifyByCountWithSettings(wasteCount, s.thresholds);
      const confidences = boxes
        .map(b => (typeof b.confidence === 'number' ? b.confidence : undefined))
        .filter(c => typeof c === 'number');
      return { ...r, boxes, wasteCount, cleanlinessPercent, imageLabel, confidences, minConfidence: minC };
    });
  }
  function deriveSummary(results, base, settings) {
    const sset = normalizeSettings(settings || SETTINGS);
    const totalImages = (base && typeof base.totalImages === 'number') ? base.totalImages : results.length;
    const valid = results.filter(r => !r.error);
    const avgCleanliness = valid.length
      ? Math.round(valid.reduce((sum, r) => sum + (r.cleanlinessPercent ?? 0), 0) / valid.length)
      : 0;
    const totalWasteItems = valid.reduce((sum, r) => sum + (r.wasteCount ?? 0), 0);
    const counts = { clean: 0, medium: 0, dirty: 0 };
    for (const r of valid) {
      const label = String(r.imageLabel || '').toLowerCase();
      if (label.includes('medium')) counts.medium++;
      else if (label.includes('dirty')) counts.dirty++;
      else counts.clean++;
    }
    const averageWastePerImage = valid.length ? Math.round((totalWasteItems / valid.length) * 100) / 100 : 0;
    const allConfs = valid.flatMap(r => (Array.isArray(r.confidences) ? r.confidences : []));
    const averageConfidencePercent = allConfs.length ? Math.round((allConfs.reduce((a,b)=>a+b,0) / allConfs.length) * 1000) / 10 : null;
    return {
      totalImages,
      processed: valid.length,
      failed: totalImages - valid.length,
      totalWasteItems,
      averageCleanlinessPercent: avgCleanliness,
      overallLabel: overallLabelFromPercentWithSettings(avgCleanliness, sset.overall),
      countClean: counts.clean,
      countMedium: counts.medium,
      countDirty: counts.dirty,
      averageWastePerImage,
      averageConfidencePercent,
      startedAt: base?.startedAt,
      durationMs: base?.durationMs,
      minConfidence: getRtMinConfidence()
    };
  }
  function classifyByCountWithSettings(count, thresholds) {
    if (count <= (thresholds?.cleanMax ?? 1)) return 'نظيف';
    if (count <= (thresholds?.mediumMax ?? 5)) return 'متوسط الاتساخ';
    return 'متسخ';
  }
  function overallLabelFromPercentWithSettings(p, overall) {
    const cleanMin = overall?.cleanMinPercent ?? 80;
    const medMin = overall?.mediumMinPercent ?? 40;
    if (p >= cleanMin) return 'نظيف';
    if (p >= medMin) return 'متوسط الاتساخ';
    return 'متسخ';
  }
  function openModal(result, src) {
    modal.classList.remove('hidden');
    modalImage.src = src;
    modalDetails.textContent = '';
    const ctx = modalCanvas.getContext('2d');
    ctx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
    modalImage.onload = () => {
      const rect = modalImage.getBoundingClientRect();
      modalCanvas.width = rect.width;
      modalCanvas.height = rect.height;
      if (SETTINGS.drawBoxes) {
        drawBoxes(result, modalImage, modalCanvas);
      }
      renderDetails(result);
    };
  }
  function renderDetails(r) {
    if (r.error) {
      modalDetails.textContent = 'Error: ' + r.error;
      return;
    }
    const confInfo = (r.confidences || []).length
      ? `avg confidence ${(avg(r.confidences) * 100).toFixed(1)}%`
      : 'no confidence data';
    const minC = typeof r.minConfidence === 'number' ? ` (min conf ${Math.round(r.minConfidence*100)}%)` : '';
    modalDetails.innerHTML = `
      <div><strong>Label:</strong> ${r.imageLabel} — <strong>${r.cleanlinessPercent}% clean</strong>${minC}</div>
      <div><strong>Detections:</strong> ${r.wasteCount} (${confInfo})</div>
    `;
  }
  function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function drawBoxes(r, img, canvas) {
    if (!r || !Array.isArray(r.boxes) || !r.boxes.length) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.font = '12px system-ui';
    ctx.textBaseline = 'top';
    const modelW = r.imageSize?.width || img.naturalWidth;
    const modelH = r.imageSize?.height || img.naturalHeight;
    const scaleX = canvas.width / modelW;
    const scaleY = canvas.height / modelH;
    r.boxes.forEach(b => {
      const x = b.x * scaleX;
      const y = b.y * scaleY;
      const w = b.width * scaleX;
      const h = b.height * scaleY;
      ctx.strokeStyle = '#22d3ee';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.2)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      const label = `${b.label || 'waste'}${typeof b.confidence === 'number' ? ` ${(b.confidence * 100).toFixed(0)}%` : ''}`;
      const tw = ctx.measureText(label).width + 6;
      const th = 16;
      ctx.fillStyle = '#111827';
      ctx.fillRect(x, Math.max(0, y - th), tw, th);
      ctx.fillStyle = '#e5e7eb';
      ctx.fillText(label, x + 3, Math.max(0, y - th));
    });
  }
  modalClose.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.classList.add('hidden');
  });
  form.addEventListener('submit', onSubmit);
  function setActiveTab(which) {
    const scan = which === 'scan';
    tabScan.classList.toggle('active', scan);
    tabSettings.classList.toggle('active', !scan);
    pageScan.classList.toggle('hidden', !scan);
    document.getElementById('results-section').classList.toggle('hidden', !scan);
    summary.classList.toggle('hidden', !scan && summary.classList.contains('hidden') ? true : !scan);
    stats.classList.toggle('hidden', !scan && stats.classList.contains('hidden') ? true : !scan);
    pageSettings.classList.toggle('hidden', scan);
  }
  if (tabScan) tabScan.addEventListener('click', () => setActiveTab('scan'));
  if (tabSettings) tabSettings.addEventListener('click', () => setActiveTab('settings'));
  if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', () => {
    SETTINGS = collectSettingsFromUI();
    saveSettings(SETTINGS);
    applySettingsToUI();
    settingsStatus.textContent = 'تم الحفظ';
    setTimeout(() => { settingsStatus.textContent = ''; }, 1200);
  });
  if (setCleanMax) setCleanMax.addEventListener('input', updateClassificationPreview);
  if (setMediumMax) setMediumMax.addEventListener('input', updateClassificationPreview);
  if (chooseBtn) chooseBtn.addEventListener('click', () => fileInput?.click());
  function updateFileCount() {
    const files = Array.from(fileInput.files || []);
    fileCount.textContent = files.length ? `${files.length} ملف(ات) محددة` : 'لم يتم اختيار ملفات';
  }
  fileInput.addEventListener('change', updateFileCount);
  ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); }));
  ;['dragleave','dragend','drop'].forEach(evt => dropzone.addEventListener(evt, (e) => { if (evt !== 'drop') { dropzone.classList.remove('dragover'); } }));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover');
    const dt = new DataTransfer();
    const existing = Array.from(fileInput.files || []);
    existing.forEach(f => dt.items.add(f));
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    updateFileCount();
  });
  rtMinConf.addEventListener('input', () => {
    setRtMinConfidence(parseFloat(rtMinConf.value));
    if (!lastResults) return;
    viewResults = deriveResultsForMinConf(lastResults.results || [], getRtMinConfidence(), SETTINGS);
    const derivedSummary = deriveSummary(viewResults, lastResults.summary || {}, SETTINGS);
    renderSummary(derivedSummary);
    renderStats(derivedSummary, viewResults);
    renderGallery(viewResults);
  });
  updateFileCount();
  applySettingsToUI();
  setActiveTab('scan');

  // Set theme to always dark
  document.documentElement.setAttribute('data-theme', 'dark');

  // Language toggle
  setTimeout(() => {
    const languageBtn = document.getElementById('language-btn');
    if (languageBtn) {
      languageBtn.addEventListener('click', () => {
        window.location.href = '/index.html';
      });
    }
  }, 100);
})();
