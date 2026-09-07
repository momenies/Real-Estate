/* ---------------------------------------------------------------------------
   Network dashboard.

   Talks to the same JSON API as everything else, as the super admin. No build
   step and no external dependency on purpose: the platform ships as one
   Railway service, and this is served straight from it.
--------------------------------------------------------------------------- */
'use strict';

const TOKEN_KEY = 'aqar.token';
const state = { token: sessionStorage.getItem(TOKEN_KEY), offices: [], view: 'overview' };

const $ = (selector) => document.querySelector(selector);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    // `dataset` is a read-only accessor - assigning to it throws.
    if (key === 'dataset') Object.assign(node.dataset, value);
    else node[key] = value;
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
};

// ── labels ────────────────────────────────────────────────────────────────
const PROPERTY_TYPES = {
  APARTMENT: 'شقة', VILLA: 'فيلا', LAND: 'أرض', BUILDING: 'عمارة', SHOP: 'محل',
  OFFICE: 'مكتب', FARM: 'مزرعة', CHALET: 'شاليه', REST_HOUSE: 'استراحة', OTHER: 'عقار',
};
const DEAL_TYPES = { SALE: 'للبيع', RENT: 'للإيجار', INVESTMENT: 'استثمار', UNKNOWN: 'غير محدد' };
const INTENTS = { BUY: 'شراء', RENT: 'إيجار', SELL: 'بيع', LEASE_OUT: 'تأجير', UNKNOWN: 'غير محدد' };
const PLANS = { TRIAL: 'تجريبي', BASIC: 'أساسي', PRO: 'احترافي' };
const OFFICE_STATUS = { PENDING: 'قيد التفعيل', ACTIVE: 'نشط', SUSPENDED: 'موقوف' };

/** Subscription state maps onto the fixed status palette; each ships with an icon AND a label. */
const SUBSCRIPTION_STATUS = {
  ACTIVE: { label: 'مشترك', status: 'good', icon: '●' },
  TRIALING: { label: 'فترة مجانية', status: 'good', icon: '◔' },
  PAST_DUE: { label: 'فترة سماح', status: 'warning', icon: '!' },
  EXPIRED: { label: 'منتهٍ', status: 'critical', icon: '✕' },
  CANCELED: { label: 'ملغى', status: 'serious', icon: '—' },
};

const nf = new Intl.NumberFormat('en-US');
const fmt = (value) => (value === null || value === undefined ? '—' : nf.format(value));
const sar = (value) => (value === null || value === undefined ? '—' : `${nf.format(value)} ريال`);
const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);

function statusChip(statusKey) {
  const meta = SUBSCRIPTION_STATUS[statusKey] ?? { label: statusKey ?? '—', status: '', icon: '·' };
  return el('span', { className: 'chip', dataset: { status: meta.status } }, [
    el('span', { className: 'icon', textContent: meta.icon, ariaHidden: 'true' }),
    meta.label,
  ]);
}

// ── api ───────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  // A 401 while signed in means the session lapsed. A 401 on the way in means
  // the credentials were wrong - saying "session expired" there is nonsense.
  if (response.status === 401 && state.token) {
    signOut();
    throw new Error('انتهت الجلسة، سجّل الدخول من جديد.');
  }
  if (response.status === 401) {
    throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `فشل الطلب (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function banner(message) {
  const node = $('#banner');
  if (!message) { node.hidden = true; return; }
  node.textContent = message;
  node.hidden = false;
}

// ── auth ──────────────────────────────────────────────────────────────────
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-btn');
  const error = $('#login-error');
  button.disabled = true;
  error.hidden = true;
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#email').value.trim(), password: $('#password').value }),
    });
    if (result.user.role !== 'SUPER_ADMIN') {
      throw new Error('هذه اللوحة لمالك المنصة فقط.');
    }
    state.token = result.accessToken;
    sessionStorage.setItem(TOKEN_KEY, state.token);
    await start();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

function signOut() {
  state.token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  $('#app').hidden = true;
  $('#login').hidden = false;
}
$('#logout').addEventListener('click', signOut);

// ── theme ─────────────────────────────────────────────────────────────────
const THEME_KEY = 'aqar.theme';
const storedTheme = localStorage.getItem(THEME_KEY);
if (storedTheme) document.documentElement.dataset.theme = storedTheme;
$('#theme-toggle').addEventListener('click', () => {
  const isDark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
        && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
});

// ── tooltip (every mark is hoverable) ─────────────────────────────────────
const tooltip = $('#tooltip');
function attachTooltip(node, html) {
  node.addEventListener('mouseenter', () => {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
  });
  node.addEventListener('mousemove', (event) => {
    tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${event.clientY + 16}px`;
  });
  node.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}

/**
 * Horizontal bars, one hue: these are single-series magnitudes, so the length
 * carries the value and the colour carries nothing. Values are labelled at the
 * tip in text ink, so the chart is readable without colour at all.
 */
function renderBars(container, rows, { note } = {}) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(el('p', { className: 'empty', textContent: 'لا توجد بيانات بعد.' }));
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  for (const row of rows) {
    const fill = el('div', { className: 'bar-fill' });
    // Length stays exactly proportional to the value; the reserved 5rem is the
    // room the tip label needs, so a full-length bar cannot push it off-card.
    fill.style.width = `calc(${row.value / max} * (100% - 5rem))`;
    const barRow = el('div', { className: 'bar-row' }, [
      el('div', { className: 'bar-name', title: row.name, textContent: row.name }),
      el('div', { className: 'bar-lane' }, [
        fill,
        el('div', { className: 'bar-value' }, [
          String(fmt(row.value)),
          row.sub ? el('div', { className: 'bar-sub', textContent: row.sub }) : null,
        ]),
      ]),
    ]);
    attachTooltip(barRow, `${row.name}<br><b>${fmt(row.value)}</b>${row.tooltip ? `<br>${row.tooltip}` : ''}`);
    container.append(barRow);
  }
  if (note) container.append(el('div', { className: 'axis-note', textContent: note }));
}

// ── views ─────────────────────────────────────────────────────────────────
async function renderOverview() {
  const [overview, expiring] = await Promise.all([
    api('/admin/overview'),
    api(`/admin/subscriptions/expiring?days=${$('#expiring-days').value}`),
  ]);

  $('#hero-leads').textContent = fmt(overview.leads);
  $('#hero-note').textContent =
    `${fmt(overview.activeLeadsLast30Days)} بحثوا خلال آخر ٣٠ يوماً`;

  const tiles = [
    ['المكاتب', overview.offices],
    ['عقارات منشورة', overview.publishedProperties],
    ['حملات إرسال', overview.broadcasts],
    ['عروض وصلت العملاء', overview.propertyDeliveries],
  ];
  $('#tiles').replaceChildren(
    ...tiles.map(([label, value]) =>
      el('div', { className: 'tile' }, [
        el('div', { className: 'tile-label', textContent: label }),
        el('div', { className: 'tile-value', textContent: fmt(value) }),
      ]),
    ),
  );

  const statuses = Object.entries(overview.subscriptionsByStatus ?? {});
  const subs = $('#sub-status');
  subs.replaceChildren();
  if (!statuses.length) {
    subs.append(el('p', { className: 'empty', textContent: 'لا توجد اشتراكات بعد.' }));
  } else {
    subs.append(el('div', { className: 'status-rows' },
      statuses.map(([key, count]) =>
        el('div', { className: 'status-row' }, [
          statusChip(key),
          el('strong', { textContent: fmt(count) }),
        ]),
      ),
    ));
  }

  const expiringNode = $('#expiring');
  expiringNode.replaceChildren();
  if (!expiring.length) {
    expiringNode.append(el('p', { className: 'empty', textContent: 'لا شيء ينتهي في هذه الفترة.' }));
  } else {
    const table = el('table');
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { textContent: 'المكتب' }),
      el('th', { textContent: 'الحالة' }),
      el('th', { textContent: 'يتبقى' }),
    ])));
    table.append(el('tbody', {}, expiring.map((subscription) => {
      const end = subscription.status === 'TRIALING'
        ? subscription.trialEndsAt
        : (subscription.currentPeriodEnd ?? subscription.trialEndsAt);
      const left = daysUntil(end);
      return el('tr', {}, [
        el('td', { className: 'wrap', textContent: subscription.office?.name ?? '—' }),
        el('td', {}, statusChip(subscription.status)),
        el('td', { className: 'num', textContent: left === null ? '—' : `${left} يوم` }),
      ]);
    })));
    expiringNode.append(table);
  }
}

async function renderOffices() {
  state.offices = await api('/admin/offices');
  drawOffices();
  const select = $('#property-filters select[name="officeId"]');
  select.replaceChildren(
    el('option', { value: '', textContent: 'كل المكاتب' }),
    ...state.offices.map((office) => el('option', { value: office.id, textContent: office.name })),
  );
}

function drawOffices() {
  const needle = $('#office-filter').value.trim();
  const rows = state.offices.filter((office) =>
    !needle || office.name.includes(needle) || (office.city ?? '').includes(needle));

  const table = $('#offices-table');
  table.replaceChildren();
  table.append(el('thead', {}, el('tr', {}, [
    'المكتب', 'المدينة', 'الحالة', 'الاشتراك', 'يتبقى', 'عقارات', 'عملاء', 'حملات', '',
  ].map((title) => el('th', { textContent: title })))));

  if (!rows.length) {
    table.append(el('tbody', {}, el('tr', {}, el('td', { colSpan: 9, className: 'empty', textContent: 'لا توجد مكاتب مطابقة.' }))));
    return;
  }

  table.append(el('tbody', {}, rows.map((office) => {
    const subscription = office.subscription;
    const end = subscription
      ? (subscription.status === 'TRIALING'
          ? subscription.trialEndsAt
          : (subscription.currentPeriodEnd ?? subscription.trialEndsAt))
      : null;
    const left = daysUntil(end);

    const activate = el('button', { className: 'ghost', textContent: 'تفعيل اشتراك' });
    activate.addEventListener('click', () => activateSubscription(office));

    return el('tr', {}, [
      el('td', { className: 'wrap', textContent: office.name }),
      el('td', { textContent: office.city ?? '—' }),
      el('td', { textContent: OFFICE_STATUS[office.status] ?? office.status }),
      el('td', {}, subscription
        ? el('span', {}, [statusChip(subscription.status), ` · ${PLANS[subscription.plan] ?? subscription.plan}`])
        : '—'),
      el('td', { className: 'num', textContent: left === null ? '—' : `${left} يوم` }),
      el('td', { className: 'num', textContent: fmt(office._count?.properties) }),
      el('td', { className: 'num', textContent: fmt(office._count?.leads) }),
      el('td', { className: 'num', textContent: fmt(office._count?.broadcasts) }),
      el('td', {}, el('div', { className: 'row-actions' }, [activate])),
    ]);
  })));
}

async function activateSubscription(office) {
  const months = Number(prompt(`تفعيل اشتراك «${office.name}» — كم شهراً؟`, '12'));
  if (!Number.isFinite(months) || months < 1) return;
  const priceSar = Number(prompt('قيمة الاشتراك بالريال؟', '3600'));
  if (!Number.isFinite(priceSar) || priceSar < 0) return;
  try {
    await api(`/admin/offices/${office.id}/subscription/activate`, {
      method: 'POST',
      body: JSON.stringify({ plan: 'BASIC', months, priceSar }),
    });
    banner('');
    await renderOffices();
  } catch (failure) {
    banner(failure.message);
  }
}
$('#office-filter').addEventListener('input', drawOffices);

async function searchProperties(event) {
  if (event) event.preventDefault();
  const form = $('#property-filters');
  const data = new FormData(form);
  const payload = { take: 100 };
  for (const [key, raw] of data.entries()) {
    const value = String(raw).trim();
    if (!value) continue;
    payload[key] = key === 'minPrice' || key === 'maxPrice' ? Number(value) : value;
  }

  const table = $('#properties-table');
  table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { className: 'empty', textContent: 'جارٍ البحث…' }))));

  const rows = await api('/admin/properties/search', { method: 'POST', body: JSON.stringify(payload) });
  table.replaceChildren();
  table.append(el('thead', {}, el('tr', {}, [
    'رقم العرض', 'المكتب', 'النوع', 'الحي', 'المدينة', 'السعر', 'المساحة', 'الغرف',
  ].map((title) => el('th', { textContent: title })))));

  if (!rows.length) {
    table.append(el('tbody', {}, el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'لا توجد نتائج.' }))));
    return;
  }

  table.append(el('tbody', {}, rows.map((property) => el('tr', {}, [
    el('td', { textContent: property.refCode }),
    el('td', { className: 'wrap', textContent: property.office?.name ?? '—' }),
    el('td', { textContent: `${PROPERTY_TYPES[property.propertyType] ?? property.propertyType} ${DEAL_TYPES[property.dealType] ?? ''}`.trim() }),
    el('td', { textContent: property.district ?? '—' }),
    el('td', { textContent: property.city ?? '—' }),
    el('td', { className: 'num', textContent: sar(property.priceSar) }),
    el('td', { className: 'num', textContent: property.areaSqm ? `${fmt(property.areaSqm)} م²` : '—' }),
    el('td', { className: 'num', textContent: fmt(property.bedrooms) }),
  ]))));
}
$('#property-filters').addEventListener('submit', searchProperties);

async function renderInsights() {
  const insights = await api('/admin/insights');

  renderBars($('#chart-type'), insights.supplyByPropertyType.map((row) => ({
    name: PROPERTY_TYPES[row.propertyType] ?? row.propertyType,
    value: row.count,
    sub: row.averagePriceSar ? `${nf.format(row.averagePriceSar)} ريال` : null,
    tooltip: row.averagePriceSar ? `متوسط السعر: ${sar(row.averagePriceSar)}` : null,
  })), { note: 'العدد هو عروض منشورة؛ الرقم الصغير هو متوسط السعر.' });

  renderBars($('#chart-city'), insights.supplyByCity.map((row) => ({
    name: row.city ?? 'غير محددة',
    value: row.count,
  })));

  renderBars($('#chart-intent'), insights.demandByIntentLast30Days.map((row) => ({
    name: INTENTS[row.intent] ?? row.intent,
    value: row.count,
  })), { note: 'يُحتسب العميل عند تسجيل بحثه، لا عند فتحه للمحادثة.' });
}

// ── navigation ────────────────────────────────────────────────────────────
const LOADERS = {
  overview: renderOverview,
  offices: renderOffices,
  properties: () => searchProperties(),
  insights: renderInsights,
};

async function show(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }
  for (const section of document.querySelectorAll('.view')) {
    section.hidden = section.id !== `view-${view}`;
  }
  try {
    banner('');
    await LOADERS[view]();
  } catch (failure) {
    banner(failure.message);
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => show(tab.dataset.view));
}
$('#refresh').addEventListener('click', () => show(state.view));
$('#expiring-days').addEventListener('change', () => show('overview'));

async function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  try {
    await renderOffices(); // fills the office filter used by the properties view
  } catch (failure) {
    banner(failure.message);
    return;
  }
  await show('overview');
}

if (state.token) {
  start().catch(() => signOut());
}
