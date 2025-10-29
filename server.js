import express from 'express';
import path from 'path';
import multer from 'multer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MIN_CONF = process.env.MIN_CONFIDENCE ? Number(process.env.MIN_CONFIDENCE) : 0.1;
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || '2EhW06WsZcd91vVV9eal';
const ROBOFLOW_URL = process.env.ROBOFLOW_URL || 'https://serverless.roboflow.com/beachscan/workflows/custom-workflow-6';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
app.use((req, res, next) => { res.set('X-Powered-By', 'BeachScanAI'); next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
const allowedImageTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, 
    files: 1000
  },
  fileFilter: (req, file, cb) => {
    if (allowedImageTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Only image uploads are allowed'));
  }
});
const parseUploads = upload.fields([
  { name: 'files', maxCount: 1000 },
  { name: 'file', maxCount: 1 }
]);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function normalizeSettings(s) {
  try {
    const obj = (typeof s === 'string') ? JSON.parse(s) : (s || {});
    const cleanMax = clamp(parseInt(obj?.thresholds?.cleanMax ?? 1, 10) || 0, 0, 100);
    const mediumMax = Math.max(cleanMax, clamp(parseInt(obj?.thresholds?.mediumMax ?? 5, 10) || 0, 0, 100));
    const perItemPenalty = clamp(parseFloat(obj?.perItemPenalty ?? 10) || 0, 0, 100);
    const cleanMinPercent = clamp(parseInt(obj?.overall?.cleanMinPercent ?? 80, 10) || 0, 0, 100);
    const mediumMinPercent = clamp(parseInt(obj?.overall?.mediumMinPercent ?? 40, 10) || 0, 0, cleanMinPercent);
    const drawBoxes = Boolean(obj?.drawBoxes !== false);
    return {
      thresholds: { cleanMax, mediumMax },
      perItemPenalty,
      overall: { cleanMinPercent, mediumMinPercent },
      drawBoxes
    };
  } catch {
    return {
      thresholds: { cleanMax: 1, mediumMax: 5 },
      perItemPenalty: 10,
      overall: { cleanMinPercent: 80, mediumMinPercent: 40 },
      drawBoxes: true
    };
  }
}
function classifyByCount(count, settings) {
  const cleanMax = settings?.thresholds?.cleanMax ?? 1;
  const mediumMax = settings?.thresholds?.mediumMax ?? 5;
  if (count <= cleanMax) return 'Clean';
  if (count <= mediumMax) return 'Medium Dirty';
  return 'Dirty';
}
function cleanlinessPercentFromCount(count, settings) {
  const perItem = settings?.perItemPenalty ?? 10;
  return clamp(100 - count * perItem, 0, 100);
}
function overallLabelFromPercent(p, settings) {
  const cleanMin = settings?.overall?.cleanMinPercent ?? 80;
  const medMin = settings?.overall?.mediumMinPercent ?? 40;
  if (p >= cleanMin) return 'Clean';
  if (p >= medMin) return 'Medium Dirty';
  return 'Dirty';
}
function pLimit(concurrency) {
  let activeCount = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || activeCount >= concurrency) return;
    activeCount++;
    const { fn, resolve, reject } = queue.shift();
    fn().then((val) => {
      resolve(val);
      activeCount--;
      next();
    }, (err) => {
      reject(err);
      activeCount--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function extractDetections(any) {
  try {
    let imageSize;
    if (any?.image && typeof any.image.width === 'number' && typeof any.image.height === 'number') {
      imageSize = { width: any.image.width, height: any.image.height };
    }
    const isDetectionLike = (d) => {
      if (!d || typeof d !== 'object') return false;
      const hasWH = typeof d.width === 'number' && typeof d.height === 'number';
      const hasXY = typeof d.x === 'number' && typeof d.y === 'number';
      const hasBBox = d.bbox && typeof d.bbox === 'object' && (
        (typeof d.bbox.x === 'number' && typeof d.bbox.y === 'number' && typeof d.bbox.w === 'number' && typeof d.bbox.h === 'number') ||
        (typeof d.bbox.left === 'number' && typeof d.bbox.top === 'number' && typeof d.bbox.width === 'number' && typeof d.bbox.height === 'number')
      );
      return (hasWH && hasXY) || hasBBox;
    };
    const candidates = [];
    if (Array.isArray(any?.predictions)) candidates.push(any.predictions);
    if (Array.isArray(any?.detections)) candidates.push(any.detections);
    if (Array.isArray(any?.objects)) candidates.push(any.objects);
    if (Array.isArray(any?.results)) candidates.push(any.results);
    if (Array.isArray(any?.outputs)) {
      for (const out of any.outputs) {
        if (out?.predictions && Array.isArray(out.predictions.predictions)) {
          candidates.push(out.predictions.predictions);
          if (out.predictions.image && typeof out.predictions.image.width === 'number' && typeof out.predictions.image.height === 'number') {
            imageSize = { width: out.predictions.image.width, height: out.predictions.image.height };
          }
        }
        if (Array.isArray(out?.predictions)) candidates.push(out.predictions);
        if (Array.isArray(out?.detections)) candidates.push(out.detections);
        if (Array.isArray(out?.objects)) candidates.push(out.objects);
        if (Array.isArray(out?.results)) candidates.push(out.results);
      }
    }
    for (const arr of candidates) {
      if (!Array.isArray(arr)) continue;
      if (arr.length === 0) return { detections: [], imageSize };
      if (arr.some(isDetectionLike)) return { detections: arr, imageSize };
    }
    return { detections: [], imageSize };
  } catch (_) {
    return { detections: [], imageSize: undefined };
  }
}
function normalizeBox(det) {
  let x, y, width, height;
  if (
    typeof det?.x === 'number' && typeof det?.y === 'number' &&
    typeof det?.width === 'number' && typeof det?.height === 'number'
  ) {
    x = det.x - det.width / 2;
    y = det.y - det.height / 2;
    width = det.width;
    height = det.height;
  } else if (det?.bbox && typeof det.bbox === 'object') {
    const b = det.bbox;
    if (typeof b.x === 'number' && typeof b.y === 'number' && typeof b.w === 'number' && typeof b.h === 'number') {
      x = b.x; y = b.y; width = b.w; height = b.h;
    } else if (
      typeof b.left === 'number' && typeof b.top === 'number' &&
      typeof b.width === 'number' && typeof b.height === 'number'
    ) {
      x = b.left; y = b.top; width = b.width; height = b.height;
    }
  }
  const label = det?.class || det?.label || det?.name || 'waste';
  const confidence = typeof det?.confidence === 'number' ? det.confidence
                    : typeof det?.score === 'number' ? det.score
                    : typeof det?.probability === 'number' ? det.probability
                    : undefined;
  if ([x, y, width, height].some(v => typeof v !== 'number' || Number.isNaN(v))) return null;
  return { x, y, width, height, label, confidence };
}
async function callRoboflow({ type, value }, { minConfidence, settings } = {}) {
  const body = { api_key: ROBOFLOW_API_KEY, inputs: { image: { type, value } } };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('Roboflow request timed out')), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ROBOFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Roboflow error ${res.status}: ${text}`);
    }
    const data = await res.json().catch(() => ({}));
    const { detections: rawDetections, imageSize } = extractDetections(data);
    const threshold = typeof minConfidence === 'number' && !Number.isNaN(minConfidence)
      ? minConfidence
      : DEFAULT_MIN_CONF;
    const boxes = rawDetections
      .map(normalizeBox)
      .filter(Boolean)
      .filter(b => typeof b.confidence !== 'number' || b.confidence >= threshold);
    const wasteCount = boxes.length;
    const normalizedSettings = normalizeSettings(settings);
    const imageLabel = classifyByCount(wasteCount, normalizedSettings);
    const cleanlinessPercent = cleanlinessPercentFromCount(wasteCount, normalizedSettings);
    const confidences = boxes
      .map(b => (typeof b.confidence === 'number' ? b.confidence : undefined))
      .filter(c => typeof c === 'number');
    return { boxes, wasteCount, confidences, imageLabel, cleanlinessPercent, imageSize, minConfidence: threshold, raw: data };
  } finally {
    clearTimeout(t);
  }
}
/**
 * POST /analyze
 * Multipart with images in `files` (multiple) or `file` (single), and/or text field `urls` (JSON array or comma/newline-separated).
 * Optional fields: `concurrency` (1-20), `minConfidence` (0-1).
 * Returns: { summary, results[] } where each result has index, source, boxes[], wasteCount, imageLabel, cleanlinessPercent.
 */
app.post('/analyze', parseUploads, asyncHandler(async (req, res) => {
  const startedAt = new Date().toISOString();
  const settings = normalizeSettings(req.body?.settings);
  let urls = [];
  const rawUrls = req.body?.urls;
  if (rawUrls) {
    try {
      const parsed = typeof rawUrls === 'string' ? JSON.parse(rawUrls) : rawUrls;
      if (Array.isArray(parsed)) urls = parsed.map(String).filter(Boolean);
    } catch {
      urls = String(rawUrls).split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
    }
  }
  const filesFromFields = /** @type {Record<string, import('multer').File[]>|undefined} */ (req.files);
  const files = [
    ...((filesFromFields && filesFromFields.files) || []),
    ...((filesFromFields && filesFromFields.file) || [])
  ];
  const inputs = [];
  let index = 0;
  for (const u of urls) inputs.push({ index: index++, type: 'url', value: u });
  for (const f of files) {
    const base64 = `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
    inputs.push({ index: index++, type: 'base64', value: base64, name: f.originalname });
  }
  if (inputs.length === 0) return res.status(400).json({ error: 'No images provided. Upload files and/or provide image URLs.' });
  const concurrency = clamp(parseInt(String(req.query.concurrency ?? req.body?.concurrency ?? 5), 10) || 5, 1, 20);
  const minConfidence = (() => {
    const v = req.query.minConfidence ?? req.body?.minConfidence;
    const n = parseFloat(String(v));
    if (!Number.isNaN(n) && n >= 0 && n <= 1) return n;
    return DEFAULT_MIN_CONF;
  })();
  const limit = pLimit(concurrency);
  const tasks = inputs.map((inp) => limit(async () => {
    const img = inp.type === 'url' ? { type: 'url', value: inp.value } : { type: 'base64', value: inp.value };
    try {
      const rf = await callRoboflow(img, { minConfidence, settings });
      return { index: inp.index, source: inp.type === 'url' ? inp.value : (inp.name || `upload-${inp.index}`), ...rf };
    } catch (err) {
      return { index: inp.index, source: inp.type === 'url' ? inp.value : (inp.name || `upload-${inp.index}`), error: String((err && err.message) || err) };
    }
  }));
  const results = await Promise.all(tasks);
  results.sort((a, b) => a.index - b.index);
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
  const endedAt = new Date();
  const summary = {
    totalImages: results.length,
    processed: valid.length,
    failed: results.length - valid.length,
    totalWasteItems,
    averageCleanlinessPercent: avgCleanliness,
    overallLabel: overallLabelFromPercent(avgCleanliness, settings),
    countClean: counts.clean,
    countMedium: counts.medium,
    countDirty: counts.dirty,
    averageWastePerImage,
    averageConfidencePercent,
    startedAt,
    durationMs: Math.max(0, endedAt - new Date(startedAt)),
    minConfidence,
    settings
  };
  return res.json({ summary, results });
}));
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/analyze') || req.path.startsWith('/healthz')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((err, req, res, next) => {
  const isPayload = err && (err.type === 'entity.too.large');
  const status = isPayload ? 413 : 400;
  const message = err?.message || 'Request error';
  res.status(status).json({ error: message });
});
app.listen(PORT, HOST);
