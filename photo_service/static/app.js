import { translations } from './i18n.js';

const $ = id => document.getElementById(id);
const preferred = localStorage.getItem('language') || navigator.language.split('-')[0];
let language = Object.hasOwn(translations, preferred) ? preferred : 'en';
let outputURL, referenceURL, activeStatus, busy = false;
let backend;
const t = key => translations[language][key] ?? translations.en[key] ?? key;

function updateReferenceHint() {
  $('reference-mode-hint').hidden = backend !== 'flux_lora' || !$('reference').files.length;
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('language').value = language;
  $('prompt').placeholder = t('placeholder');
  $('output').alt = t('result');
  if (activeStatus) $('job-status').textContent = t(activeStatus);
  refreshHealth();
}

$('language').addEventListener('change', event => {
  language = event.target.value;
  localStorage.setItem('language', language);
  applyLanguage();
});

async function refreshHealth() {
  try {
    const response = await fetch('/healthz');
    if (!response.ok) throw new Error('network_error');
    const health = await response.json();
    backend = health.engine;
    updateReferenceHint();
    $('connection').textContent = t(health.worker_online ? 'online' : 'offline');
    $('demo').hidden = health.engine !== 'mock';
  } catch { $('connection').textContent = t('network_error'); }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${$('token').value.trim()}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = response.status === 401 ? 'unauthorized' :
      typeof body.detail === 'string' ? body.detail : 'invalid_request';
    throw new Error(code);
  }
  return response;
}

$('reference').addEventListener('change', () => {
  updateReferenceHint();
  if (referenceURL) URL.revokeObjectURL(referenceURL);
  const file = $('reference').files[0];
  $('reference-preview').hidden = !file;
  if (file) {
    referenceURL = URL.createObjectURL(file);
    $('reference-preview').src = referenceURL;
  }
});

function showError(error) {
  $('error').textContent = t(error.message in translations.en ? error.message : 'network_error');
  $('error').hidden = false;
}

async function followJob(id) {
  for (;;) {
    const job = await (await api(`/api/jobs/${id}`)).json();
    activeStatus = job.status;
    $('job-status').textContent = t(job.status);
    $('job-info').textContent = `${job.width} × ${job.height} · Seed ${job.seed}`;
    if (job.status === 'failed') throw new Error(job.error_code || 'generation_failed');
    if (job.status === 'succeeded') {
      const blob = await (await api(`/api/jobs/${id}/output`)).blob();
      if (outputURL) URL.revokeObjectURL(outputURL);
      outputURL = URL.createObjectURL(blob);
      $('output').src = outputURL;
      $('output').hidden = false;
      $('download').href = outputURL;
      $('download').download = `${id}.png`;
      $('download').hidden = false;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

$('generation-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $('generate').disabled = true;
  $('error').hidden = true;
  try {
    const form = new FormData(event.target);
    if (!$('reference').files.length) form.delete('reference');
    if ($('reference').files[0]?.size > 10 * 1024 * 1024) throw new Error('upload_too_large');
    const job = await (await api('/api/jobs', { method: 'POST', body: form })).json();
    $('empty').hidden = true;
    $('output').hidden = true;
    $('download').hidden = true;
    $('progress').hidden = false;
    await followJob(job.id);
  } catch (error) { showError(error); }
  finally {
    $('progress').hidden = true;
    $('generate').disabled = false;
    busy = false;
  }
});

applyLanguage();
setInterval(refreshHealth, 10000);
