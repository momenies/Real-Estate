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

// ── modal ─────────────────────────────────────────────────────────────────
/**
 * Control actions are consequential - suspending an office, loosening its
 * anti-spam guardrails, charging for a subscription. `window.prompt` cannot
 * show what the current value is, cannot validate, and cannot be cancelled
 * safely, so these get a real form.
 *
 * `fields` are rendered in order; the resolved value is an object of their
 * values, or null when dismissed.
 */
function openModal({ title, note, fields = [], confirmLabel = 'تأكيد' }) {
  const backdrop = $('#modal');
  const form = $('#modal-form');
  const error = $('#modal-error');
  $('#modal-title').textContent = title;
  $('#modal-note').textContent = note ?? '';
  $('#modal-note').hidden = !note;
  $('#modal-confirm').textContent = confirmLabel;
  error.hidden = true;
  form.replaceChildren();

  for (const field of fields) {
    const input =
      field.type === 'select'
        ? el(
            'select',
            { name: field.name },
            field.options.map((option) =>
              el('option', {
                value: String(option.value),
                textContent: option.label,
                selected: String(option.value) === String(field.value),
              }),
            ),
          )
        : el('input', {
            name: field.name,
            type: field.type ?? 'text',
            value: field.value ?? '',
            ...(field.type === 'checkbox' ? { checked: !!field.value } : {}),
            ...(field.min !== undefined ? { min: String(field.min) } : {}),
            ...(field.max !== undefined ? { max: String(field.max) } : {}),
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          });
    form.append(
      el('label', { className: field.type === 'checkbox' ? 'check' : '' }, [
        field.label,
        input,
        field.hint ? el('span', { className: 'muted', textContent: field.hint }) : null,
      ]),
    );
  }

  backdrop.hidden = false;
  (form.querySelector('input, select') ?? $('#modal-confirm')).focus();

  return new Promise((resolve) => {
    const close = (value) => {
      backdrop.hidden = true;
      $('#modal-confirm').onclick = null;
      $('#modal-cancel').onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    $('#modal-cancel').onclick = () => close(null);
    $('#modal-confirm').onclick = () => {
      const data = {};
      for (const input of form.querySelectorAll('input, select')) {
        data[input.name] =
          input.type === 'checkbox'
            ? input.checked
            : input.type === 'number'
              ? (input.value === '' ? null : Number(input.value))
              : input.value.trim();
      }
      close(data);
    };
  });
}

function modalError(message) {
  const error = $('#modal-error');
  error.textContent = message;
  error.hidden = false;
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

    const action = (label, handler, title) => {
      const button = el('button', { className: 'ghost', textContent: label, title: title ?? label });
      button.addEventListener('click', () => handler(office));
      return button;
    };

    return el('tr', { dataset: { officeStatus: office.status } }, [
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
      el(
        'td',
        {},
        el('div', { className: 'row-actions' }, [
          action('🛡 الحماية', editGuardrails, 'تعديل حدود الإرسال وساعات الهدوء'),
          action('💳 تفعيل', activateSubscription, 'تفعيل أو تجديد الاشتراك'),
          subscription && subscription.status !== 'CANCELED'
            ? action('✕ إلغاء', cancelSubscription, 'إلغاء الاشتراك')
            : null,
          action(
            office.status === 'SUSPENDED' ? '▶ تفعيل المكتب' : '⏸ إيقاف',
            toggleOfficeStatus,
            office.status === 'SUSPENDED' ? 'إعادة تفعيل المكتب' : 'إيقاف خدمة المكتب',
          ),
        ]),
      ),
    ]);
  })));
}

/** Converts a trial, or renews - the only control action that involves money. */
async function activateSubscription(office) {
  const values = await openModal({
    title: `تفعيل اشتراك «${office.name}»`,
    note: 'يبدأ الاشتراك من تاريخ انتهاء الفترة الحالية، فلا يخسر المكتب ما تبقّى له.',
    confirmLabel: 'تفعيل',
    fields: [
      {
        name: 'plan',
        label: 'الخطة',
        type: 'select',
        value: 'BASIC',
        options: [
          { value: 'BASIC', label: 'أساسي' },
          { value: 'PRO', label: 'احترافي' },
        ],
      },
      { name: 'months', label: 'عدد الأشهر', type: 'number', value: 12, min: 1, max: 60 },
      { name: 'priceSar', label: 'القيمة (ريال)', type: 'number', value: 3600, min: 0 },
    ],
  });
  if (!values) return;
  if (!values.months || values.months < 1) return modalError('عدد الأشهر غير صالح.');

  await runControlAction(() =>
    api(`/admin/offices/${office.id}/subscription/activate`, {
      method: 'POST',
      body: JSON.stringify({
        plan: values.plan,
        months: values.months,
        priceSar: values.priceSar ?? 0,
      }),
    }),
  );
}

async function cancelSubscription(office) {
  const values = await openModal({
    title: `إلغاء اشتراك «${office.name}»`,
    note: 'بيانات المكتب وعملاؤه تبقى كما هي؛ ما يتوقف هو إضافة العروض والإرسال.',
    confirmLabel: 'إلغاء الاشتراك',
    fields: [{ name: 'reason', label: 'السبب (اختياري)', placeholder: 'عدم السداد' }],
  });
  if (!values) return;
  await runControlAction(() =>
    api(`/admin/offices/${office.id}/subscription/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: values.reason || undefined }),
    }),
  );
}

/**
 * Suspending an office stops it being served entirely - inbound messages are
 * dropped and any queued broadcast stops dispatching.
 */
async function toggleOfficeStatus(office) {
  const suspending = office.status !== 'SUSPENDED';
  const values = await openModal({
    title: suspending ? `إيقاف «${office.name}»` : `إعادة تفعيل «${office.name}»`,
    note: suspending
      ? 'سيتوقف البوت عن استقبال رسائل هذا المكتب، وسيتوقف أي إرسال قائم في منتصفه.'
      : 'سيعود المكتب للعمل فوراً، وأي إرسال كان محتجزاً سيُستكمل.',
    confirmLabel: suspending ? 'إيقاف' : 'تفعيل',
    fields: [],
  });
  if (!values) return;
  await runControlAction(() =>
    api(`/admin/offices/${office.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: suspending ? 'SUSPENDED' : 'ACTIVE' }),
    }),
  );
}

/** The guardrails that decide how hard an office may hit its customers. */
async function editGuardrails(office) {
  let settings;
  try {
    settings = await api(`/admin/offices/${office.id}/settings`);
  } catch (failure) {
    return banner(failure.message);
  }

  const values = await openModal({
    title: `حماية «${office.name}»`,
    note: 'هذه القيم تحدد كم يُزعج المكتب عملاءه — وبها يُحمى رقمه من الحظر.',
    confirmLabel: 'حفظ',
    fields: [
      {
        name: 'dailyCapPerLead',
        label: 'أقصى إعلانات للعميل يومياً',
        type: 'number',
        value: settings.dailyCapPerLead,
        min: 1,
        max: 10,
      },
      {
        name: 'minHoursBetweenMessages',
        label: 'أقل فاصل بين رسالتين للعميل (ساعة)',
        type: 'number',
        value: settings.minHoursBetweenMessages,
        min: 0,
        max: 72,
      },
      {
        name: 'quietHoursStart',
        label: 'بداية ساعات الهدوء',
        type: 'number',
        value: settings.quietHoursStart,
        min: 0,
        max: 23,
      },
      {
        name: 'quietHoursEnd',
        label: 'نهاية ساعات الهدوء',
        type: 'number',
        value: settings.quietHoursEnd,
        min: 0,
        max: 24,
      },
      {
        name: 'broadcastRatePerMinute',
        label: 'رسائل في الدقيقة',
        type: 'number',
        value: settings.broadcastRatePerMinute,
        min: 1,
        max: 60,
        hint: 'الأعلى يعني إرسالاً أسرع ومخاطرة أكبر على الرقم.',
      },
      {
        name: 'autoSendLatestToNewLead',
        label: 'إرسال «آخر الموجود» للعميل الجديد',
        type: 'checkbox',
        value: settings.autoSendLatestToNewLead,
      },
    ],
  });
  if (!values) return;

  await runControlAction(() =>
    api(`/admin/offices/${office.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    }),
  );
}

/** Every control action refreshes the table and the trail, or shows why not. */
async function runControlAction(action) {
  try {
    await action();
    banner('');
    await renderOffices();
  } catch (failure) {
    banner(failure.message);
  }
}

async function onboardOffice(event) {
  event.preventDefault();
  const form = $('#onboard-form');
  const payload = {};
  for (const [key, raw] of new FormData(form).entries()) {
    const value = String(raw).trim();
    if (value) payload[key] = value;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const office = await api('/offices', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    form.hidden = true;
    $('#toggle-onboard').setAttribute('aria-expanded', 'false');
    $('#toggle-onboard').textContent = 'إظهار النموذج';
    banner('');
    await renderOffices();
    banner(`تم ضمّ «${office.name}» وبدأت فترته المجانية.`);
  } catch (failure) {
    banner(failure.message);
  } finally {
    submit.disabled = false;
  }
}
$('#onboard-form').addEventListener('submit', onboardOffice);
$('#toggle-onboard').addEventListener('click', () => {
  const form = $('#onboard-form');
  form.hidden = !form.hidden;
  const button = $('#toggle-onboard');
  button.setAttribute('aria-expanded', String(!form.hidden));
  button.textContent = form.hidden ? 'إظهار النموذج' : 'إخفاء النموذج';
});

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

const AUDIT_LABELS = {
  office_suspended: 'إيقاف مكتب',
  office_status_changed: 'تغيير حالة مكتب',
  office_settings_updated: 'تعديل الحماية',
};

/** The control trail. Without it, "who loosened this office's limits?" has no answer. */
async function renderAudit() {
  const rows = await api('/admin/audit?take=100');
  const table = $('#audit-table');
  table.replaceChildren();
  table.append(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ['الوقت', 'الإجراء', 'المكتب', 'ما تغيّر'].map((title) => el('th', { textContent: title })),
      ),
    ),
  );

  if (!rows.length) {
    table.append(
      el(
        'tbody',
        {},
        el('tr', {}, el('td', { colSpan: 4, className: 'empty', textContent: 'لا إجراءات مسجّلة بعد.' })),
      ),
    );
    return;
  }

  const describe = (row) => {
    const meta = row.meta ?? {};
    if (meta.changed && Object.keys(meta.changed).length) {
      return Object.entries(meta.changed)
        .map(([key, change]) => `${key}: ${change.from} → ${change.to}`)
        .join(' · ');
    }
    if (meta.from && meta.to) return `${meta.from} → ${meta.to}`;
    return '—';
  };

  table.append(
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('td', {
            className: 'num',
            textContent: new Date(row.createdAt).toLocaleString('en-GB', { hour12: false }),
          }),
          el('td', { textContent: AUDIT_LABELS[row.action] ?? row.action }),
          el('td', { className: 'wrap', textContent: row.officeName ?? '—' }),
          el('td', { className: 'audit-meta', textContent: describe(row) }),
        ]),
      ),
    ),
  );
}
$('#refresh-audit').addEventListener('click', () => show('control'));

// ── navigation ────────────────────────────────────────────────────────────
const LOADERS = {
  overview: renderOverview,
  offices: renderOffices,
  properties: () => searchProperties(),
  insights: renderInsights,
  control: renderAudit,
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
