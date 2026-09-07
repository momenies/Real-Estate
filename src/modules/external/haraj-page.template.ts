/**
 * The Haraj helper page.
 *
 * Deliberately a single self-contained HTML string: the office owner opens it
 * from a WhatsApp link on an old phone, taps "نسخ", and pastes into the Haraj
 * app. No build step, no framework, no login.
 */
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

interface HarajPayload {
  title?: string;
  body?: string;
  images?: string[];
  videos?: string[];
  location?: { mapUrl: string } | null;
}

export function renderHarajPage(publication: {
  caption: string | null;
  payload: unknown;
  office: { name: string };
  property: { refCode: string };
}): string {
  const payload = (publication.payload ?? {}) as HarajPayload;
  const title = escapeHtml(payload.title ?? publication.caption ?? '');
  const body = escapeHtml(payload.body ?? '');
  const images = payload.images ?? [];

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>تجهيز إعلان حراج - ${escapeHtml(publication.property.refCode)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#16a34a; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --card:#171a21; --ink:#f3f4f6; --muted:#9ca3af; --line:#2b2f3a; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink);
         font-family: -apple-system, "Segoe UI", Tahoma, Arial, sans-serif; line-height:1.7; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:14px; }
  h1 { font-size:1.1rem; margin:0 0 4px; }
  .muted { color:var(--muted); font-size:.85rem; }
  pre { white-space:pre-wrap; word-wrap:break-word; margin:0; font-family:inherit; font-size:1rem; }
  button { width:100%; padding:14px; margin-top:12px; border:0; border-radius:10px;
           background:var(--accent); color:#fff; font-size:1rem; font-weight:600; cursor:pointer; }
  button:active { opacity:.85; }
  .imgs { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:8px; }
  .imgs img { width:100%; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--line); }
  .steps { padding-inline-start:20px; margin:8px 0 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>إعلان جاهز للنشر في حراج</h1>
    <div class="muted">${escapeHtml(publication.office.name)} — العرض ${escapeHtml(publication.property.refCode)}</div>
    <ol class="steps muted">
      <li>انسخ العنوان والنص بالضغط على الأزرار</li>
      <li>افتح تطبيق حراج وأضف إعلان جديد</li>
      <li>الصق النص، وأرفق الصور بالضغط عليها للحفظ</li>
    </ol>
  </div>

  <div class="card">
    <div class="muted">العنوان</div>
    <pre id="title">${title}</pre>
    <button onclick="copyText('title', this)">نسخ العنوان</button>
  </div>

  <div class="card">
    <div class="muted">نص الإعلان</div>
    <pre id="body">${body}</pre>
    <button onclick="copyText('body', this)">نسخ نص الإعلان</button>
  </div>

  ${
    images.length
      ? `<div class="card">
    <div class="muted">الصور (${images.length}) — اضغط مطولاً على الصورة لحفظها</div>
    <div class="imgs">${images
      .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="" loading="lazy"></a>`)
      .join('')}</div>
  </div>`
      : ''
  }

  ${
    payload.location
      ? `<div class="card"><a href="${escapeHtml(payload.location.mapUrl)}" target="_blank" rel="noopener">📍 فتح موقع العقار على الخريطة</a></div>`
      : ''
  }

<script>
  async function copyText(id, button) {
    var text = document.getElementById(id).innerText;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Older in-app browsers have no clipboard API; fall back to a selection.
      var range = document.createRange();
      range.selectNodeContents(document.getElementById(id));
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      selection.removeAllRanges();
    }
    var original = button.textContent;
    button.textContent = 'تم النسخ ✅';
    setTimeout(function () { button.textContent = original; }, 1500);
  }
</script>
</body>
</html>`;
}
