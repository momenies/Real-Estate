# شبكة عقار — Aqar Network

منصة SaaS لمكاتب العقار التقليدية. واجهة صاحب المكتب هي **الواتساب فقط**، وخلفها قاعدة
بيانات مركزية واحدة تجمع عقارات وعملاء كل المكاتب في شبكة عقارية واحدة.

> A multi-tenant SaaS for traditional real-estate offices. The office owner's only
> interface is WhatsApp; behind it, one central database quietly becomes a
> network-wide property and customer graph.

---

## الفكرة في سطر واحد

صاحب المكتب — الذي لا يريد تطبيقاً ولا لوحة تحكم — يرسل **صور العقار، مقطع فيديو، السعر
والحي، ودبوس الموقع** إلى رقم واتساب واحد، فيتحول ذلك تلقائياً إلى عرض منظّم، ويُرسل
للعملاء المناسبين دون تكرار ودون إزعاج.

## ما الذي يجعلها تعمل

| المتطلب | كيف نُفّذ |
|---|---|
| اشتراك مدفوع + **3 أشهر مجاناً** | `TRIAL_DAYS=90` مع فترة سماح، وتذكير على الواتساب قبل الانتهاء |
| قاعدة بيانات مركزية واحدة | PostgreSQL واحدة، و`officeId` على كل صف |
| عزل تام بين المكاتب | امتداد Prisma يفرض النطاق + سياسات RLS في PostgreSQL |
| تحكم شامل للمالك | لوحة واحدة على `/dashboard` يراها `SUPER_ADMIN` وحده |
| صفر شاشات لصاحب المكتب | حالة محادثة على الواتساب فقط: صور + سعر + حي + دبوس |
| واتساب رسمي | WhatsApp Cloud API من Meta، بتحقق من توقيع كل Webhook |
| تشغيل ٢٤ ساعة | NestJS على Railway، ومهام مجدولة داخل نفس الخدمة |
| تيك توك رسمي | OAuth مرة واحدة + Content Posting API |
| حراج بأمان | تجهيز ذكي للنسخ واللصق — بدون أتمتة تُعرّض الحساب للحظر |
| تصنيف العملاء تلقائياً | أزرار سريعة تسجّل النية والنوع والحي والميزانية |
| إرسال موجّه | «أرسله لعملاء آخر شهر / أسبوع / يوم» بضغطة واحدة |
| منع الإزعاج والتكرار | عدم تكرار العرض لنفس العميل أبداً + حد يومي + تهدئة + ساعات هدوء |

---

## التشغيل محلياً

```bash
cp .env.example .env          # ثم عدّل DATABASE_URL على الأقل
docker compose up -d postgres # أو استخدم PostgreSQL موجود لديك
npm install
npx prisma migrate deploy
npm run db:seed               # مكتب تجريبي بعقارات وعملاء
npm run start:dev
```

- **لوحة الشبكة: `http://localhost:3000/dashboard/`** (لمالك المنصة فقط)
- توثيق الـ API: `http://localhost:3000/api/docs`
- فحص الصحة: `http://localhost:3000/health`

## الاختبارات

```bash
npm test
```

الاختبارات التي تحتاج قاعدة بيانات تتخطّى نفسها تلقائياً إذا لم يكن `DATABASE_URL` موجوداً.
تغطي: تحليل النص العربي، عزل المكاتب (على قاعدة بيانات حقيقية)، قواعد منع الإزعاج،
ومنع تكرار معالجة الـ Webhook.

### التكامل المستمر (CI)

يعمل [`.github/workflows/ci.yml`](.github/workflows/ci.yml) على كل PR بثلاث وظائف:

| الوظيفة | ما تتحقق منه |
|---|---|
| `quality` | التنسيق (Prettier) وفحص الأنواع |
| `test` | الهجرات على قاعدة فارغة، عدم انحراف المخطط، **تفعيل RLS على كل جدول**، ثم الاختبارات على PostgreSQL حقيقي |
| `build` | بناء الإنتاج يُخرج `dist/main.js` فعلاً، ولا ذاكرة بناء مرفوعة في git |

نقطتان مقصودتان:

- الاختبارات تُشغَّل بقاعدة بيانات حقيقية، ثم تُفحص النتيجة للتأكد أن **لا اختبار
  تخطّى نفسه** — وإلا لمرّت الوظيفة خضراء وهي لم تختبر شيئاً تقريباً.
- أي جدول جديد بلا سياسة RLS يُفشل الـ CI، فلا يمكن إضافة جدول للمستأجرين
  ونسيان عزله.

---

## الوثائق

| المستند | المحتوى |
|---|---|
| [`docs/VISION.md`](docs/VISION.md) | بيان المتطلبات الأصلي للمنصة |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | البنية، العزل، ولماذا اتُّخذ كل قرار |
| [`docs/DASHBOARD.md`](docs/DASHBOARD.md) | لوحة الشبكة: الشاشة الوحيدة، ولمن هي |
| [`docs/WHATSAPP_SETUP.md`](docs/WHATSAPP_SETUP.md) | ربط رقم واتساب لكل مكتب خطوة بخطوة |
| [`docs/DEPLOYMENT_RAILWAY.md`](docs/DEPLOYMENT_RAILWAY.md) | النشر على Railway مع Supabase |
| [`docs/ANTI_SPAM.md`](docs/ANTI_SPAM.md) | قواعد منع التكرار والإزعاج بالتفصيل |
| [`docs/EXTERNAL_CHANNELS.md`](docs/EXTERNAL_CHANNELS.md) | تيك توك وحراج |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | تشغيل المنصة يومياً وضم مكتب جديد |

## بنية المشروع

```
prisma/schema.prisma          نموذج البيانات المركزي
prisma/migrations/            يتضمّن سياسات RLS
src/common/prisma/            امتداد العزل متعدد المستأجرين
src/common/tenancy/           نطاق المكتب لكل طلب
src/common/utils/             تحليل النص العربي، الأرقام، التوقيت
src/modules/whatsapp/         الـ Webhook، عميل Cloud API، ومسارات المحادثة
src/modules/properties/       العروض ومسوداتها
src/modules/leads/            العملاء وتصنيفهم
src/modules/broadcasts/       الاستهداف، منع الإزعاج، ومُرسِل مُنظَّم
src/modules/subscriptions/    التجربة المجانية ودورة الاشتراك
src/modules/external/         تيك توك وحراج
src/modules/admin/            لوحة الشبكة للمالك
```

## ملاحظة أمنية

`WHATSAPP_APP_SECRET` مطلوب في الإنتاج. بدونه يتخطى التطبيق التحقق من توقيع الـ Webhook
(مع تحذير في السجل)، وهو مقبول محلياً فقط — لأن من يعرف الرابط سيستطيع حقن رسائل باسم أي مكتب.
