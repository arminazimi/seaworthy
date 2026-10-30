# Persian developer communities (Telegram / Discord) — launch draft (#129)

**This is a draft for review, not a post to send.** قبل از انتشار: یک بار دیگر خروجی واقعی را با
کامیت منتشرشده مقایسه کنید؛ حتماً این متن را یک گویندهٔ بومی فارسی بازخوانی کند؛ لینک مخزن را
آزمایش کنید. Owner: `launch1.posts`. (Before publishing: re-check the pasted run against your
publish commit, have a native Persian speaker review this draft, and test the repository link.)

## Format limits

- The kit's shape: the same post in Persian, for the Telegram and Discord groups; keep the
  command, the check IDs, and the file names untranslated. No character count is set for this
  channel in the kit, so the constraint is in words: Telegram and Discord group posts are read on
  phones — keep it to one screenful, one link, and plain text; the command blocks stay in English
  (`npx seaworthy verify ./dist`, `links.internal`, `a11y.aria-attributes`, the fixture paths).

## Hook (خط اول)

> سایت‌استاتیک ساخته‌شده را قبل از دیپلوی چک کنید: ابزاری که خروجی build را می‌خواند و به هر
> خطا شناسه، آدرس دقیق و راه‌حل می‌دهد (پیش‌آلفا، توسعه در ملأ عام)

## Body

Seaworthy سایت‌ها را برای ایجنت‌ها راستی‌آزمایی می‌کند. وضعیت: پیش‌آلفا — هنوز روی npm منتشر
نشده، نسخه‌ای وجود ندارد؛ هرچه در ادامه می‌بینید از کد مخزن قابل بازتولید است.

ایجنت‌ها تمام‌روز وب‌سایت می‌سازند و وقتی کد کامپایل می‌شود می‌گویند «تمام» — نه وقتی سایت
واقعاً کار می‌کند. لینک شکسته، بیس‌URL غلط، alt متن جاافتاده، صفحه‌ای که ایجنت نمی‌تواند بخواند:
هیچ‌چیز خروجی build را چک نمی‌کند. Seaworthy همان چک است: یک کامند، هر سایت استاتیکی از هر
فریمورکی، و یک گزارش نسخه‌دار و ماشین‌خوان.

خروجی واقعی از fixture خود مخزن (۱۵۱ صفحه، ۷۸ چک):

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken
```

```text
fixtures/broken/a11y-hidden-focusable/site/index.html
  10:41   error   links.internal  Link to /pricing points to a page that does not exist in the built site.
          fix: Point the link at an existing page, or add the missing page.
```

هر یافته سه چیز دارد: شناسهٔ پایدار چک (`links.internal`، `a11y.aria-attributes` و…)، آدرس دقیق
(فایل، خط، ستون)، و راهنمای رفع. گزارش JSON یک فیلد `prompt` هم دارد: متنی آماده برای دادن به
ایجنتِ کدنویس — ایجنت در سورس اصلاح می‌کند، ری‌بیلد می‌کند و دوباره verify می‌گیرد.

چیزهایی که صادقانه هنوز درست نشده: انتشار روی npm، نسخه، بنچمارک. چک‌ها مگر با opt-in (`--network`)
شبکه را نمی‌بینند. Seaworthy فقط گزارش می‌دهد و هرگز فایل شما را ویرایش نمی‌کند. مخزن شامل یک MCP
server (`packages/mcp`) و GitHub Action (`action.yml`) هم هست که از سورس قابل استفاده‌اند و هنوز
منتشر نشده‌اند.

## Call to action

مخزن را بخوانید، از سورس اجرا کنید (`npm ci && npm run build`)، و برای هر یافته‌ای که غلط به
نظرتان رسید یک issue باز کنید:
https://github.com/arminazimi/seaworthy

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) — همان
تصویر همهٔ کانال‌ها؛ دستور و شناسهٔ چک‌ها در تصویر انگلیسی می‌مانند.
