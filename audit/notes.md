# Phase 9 Visual Audit — raw walk notes (working file)

Prod: planner-olive-sigma.vercel.app · viewport 1440×900 · admin = transcorp-admin@planner.test (Transcorp tenant)

## ADMIN

### admin-01 /admin/merchants  [shot: admin-01-merchants.png]
- "+ NEW MERCHANT" button TEXT WRAPS to 2 lines ("+ NEW" / "MERCHANT") — button too narrow for content. (Button component gap)
- Stat card "8 … GENUINE MERCHANTS": number hard-left, label hard-right, large dead gap between; label vertically centered against oversized numeral — unbalanced, no clear stat-card pattern.
- Header casing system inconsistent: H1 "Merchants" title case; column headers NAME/SLUG/STATUS/CREATED/ACTIONS uppercase + letter-spaced; eyebrow "TRANSCORP · ADMIN" uppercase.
- Slug cells in monospace (mlp, demo-bistro1) vs names in sans — mixed type treatment in one table.
- Status badge "ACTIVE" = pale low-contrast green pill, uppercase; weak contrast.
- "DEACTIVATE" action = outlined uppercase button; only one action; row is also a link (whole-row click) → click target overlaps button.
- Row height loose; lots of vertical padding.
- GOOD: test-tenant filter works here ("8 Genuine merchants"); headers single-line. The 736/test-tenant issue is on Overview (/admin/calendar), NOT here.
- Merchant detail IDs (for later): Meal Plan Scheduler = 4d53221c-7681-406b-8e46-224cd75a5c5b

### admin-02 /admin/merchants/[id] (detail)  [shot: admin-02-merchant-detail.png]
- VERY low information density: content locked to ~560px center-left column; entire right half of a 1440 viewport is empty. No use of horizontal space.
- FieldRow pattern (label left / value right) is consistent here but labels are uppercase + letter-spaced gray = heavy, shouty for a read view.
- AUTH METHOD value "OAUTH" appears indented further right than all other values (NAME/SLUG/CREATED/CUSTOMER CODE align at one x; OAUTH is offset) — value-column misalignment.
- Empty pickup address = three stacked "—" rows (ADDRESS LINE/DISTRICT/EMIRATE) eating vertical space; weak empty state.
- Value typography mixed: SLUG mono, region parenthetical mono, code/date plain sans — no rule for when mono is used.
- Badge/pill zoo on one page: ACTIVE (pale green), CONFIGURED (pale green), ENABLED (green-dot pill) + DISABLE (outline btn) — at least 3 pill styles.
- Button/link zoo: UPDATE MERCHANT (outline uppercase), MANAGE CREDENTIALS → (text link), DISABLE (outline btn), COPY (icon btn), ← BACK TO MERCHANTS (text link). No single Button system.
- Webhook URL wraps to 2 lines inside its boxed field.
- Section headers (IDENTITY/PICKUP ADDRESS/ROUTING/ASSET TRACKING) understated uppercase gray + hairline rule; very quiet.

### admin-03 /admin/merchants/[id]/edit  [shot: admin-03-merchant-edit.png]
- SAME-LABEL BUTTON, TWO STYLES: "UPDATE MERCHANT" here is a GREEN FILLED button; on the detail page it was an OUTLINE button. Primary-action style is not standardized.
- Pickup-address inputs show light-gray text ("Building 4, Sheikh Zayed Road" / "Al Quoz" / "Dubai") that reads like real values but are placeholders (detail showed "—"). Placeholder vs value ambiguity.
- SUITEFLEET REGION is a native browser <select> (OS-default chrome) sitting among custom-styled text inputs — inconsistent control styling.
- SLUG input is disabled/mono + helper "not editable here"; disabled state barely distinguished from active inputs.
- Labels uppercase letter-spaced (same heavy treatment as everywhere).
- Content again ~560px left column; right half of viewport empty.
- Loose vertical rhythm: section header → gap → helper paragraph → gap → fields.
- CANCEL is a bare text link next to the filled primary — weak secondary-action affordance.

### admin-04 /admin/merchants/[id]/credentials  [shot: admin-04-merchant-credentials.png]
- PAGE-WIDTH INCONSISTENCY: this page is centered ~900px wide; detail+edit were a narrow ~560px LEFT column. No shared page-shell/max-width rule across admin.
- Casing inconsistency: card title "Authentication method" is sentence case, but section header "ROTATE CREDENTIALS" + eyebrow are uppercase letter-spaced. Two header systems on one page.
- Container inconsistency: auth-method block is a bordered card; ROTATE block is bare (no card). Mixed container treatment.
- Inputs show browser-autofill blue tint; OAUTH USERNAME pre-filled with the admin's own login email (autofill leak) — confusing in a credential-rotation context.
- Buttons: CANCEL (text link) + ROTATE CREDENTIALS (green filled) — matches edit's primary, but differs from detail's outline primary.

### admin-05 /admin/merchants/new  [shot: admin-05-merchant-new.png]
- Confirms placeholders are concrete-looking examples (Demo Bistro / demo-bistro / Building 4, Sheikh Zayed Road / Al Quoz / Dubai / 000) — same placeholder-as-value ambiguity as edit.
- FORM FIELD-SET INCONSISTENCY vs edit: New form has NO "SUITEFLEET REGION" select; Edit form does. Same entity, different field sets across create/edit.
- Same repeats: uppercase letter-spaced labels, ~560px left column (right half empty), loose vertical rhythm, green filled CREATE MERCHANT + text CANCEL.

### admin-06 /admin/calendar = "Operations overview" (nav: Overview)  [shots: admin-06-overview-top.png (readable), admin-06-overview.png (full height, shows scale)]
- *** HEADLINE DEFECT — test-tenant leak (3 places), #546 filter NOT applied here ***
  1. Stat "ACTIVE MERCHANTS: 736 / Tenants in active status" — genuine = 8 (per /admin/merchants). Counts ~728 automated-test tenants.
  2. "TOP MERCHANTS TODAY — top 10 by total deliveries": rows 01–10 ALL = "Service B Test Tenant" (4 each). Entire leaderboard is test data.
  3. "Per-merchant breakdown": unbounded list of HUNDREDS of tenants (a11y tree = 4,581 lines; 749 'test' matches). Confirms full leak + perf problem (renders every tenant).
- PERF/SCALE: page renders an unbounded per-merchant list (no pagination/virtualization) — 4,500+ DOM rows.
- STAT-CARD COMPONENT INCONSISTENCY: here = 5 bordered cards (uppercase label / big number / sublabel; FAILED card pink-tinted). On /admin/merchants the stat was ONE wide card (number-left / label-right). Two different stat-card designs.
- Numbered rank rows 01/02/03 (numbering justified = it's a rank). Rows tall/loose.
- Otherwise clean: H1 "Operations overview" sentence case, date subtitle, good card grid at top.
- NOTE: nav label "Overview" routes to /admin/calendar but there is NO calendar on it — it's a dashboard. Route name (calendar) ≠ content (overview dashboard) ≠ nav label (Overview). Naming drift.

### admin-07 /admin/tasks  [shot: admin-07-tasks.png]
- STAT CARD = wide number-left/label-right ("5 … TOTAL TASKS") — matches /admin/merchants card, DIFFERS from Overview's 5-card grid. (2 stat-card systems across admin.)
- MIXED DROPDOWN STYLES in the filter row: "TODAY" is a custom-styled button-dropdown; MERCHANT/STATUS/PER PAGE are native browser <select> (OS chrome). Inconsistent control system.
- STATUS RENDERING NOT UNIFORM: "CREATED" shows an icon + badge styling; "SKIPPED" rows are bare gray text with no badge. Status should be one Badge component with a per-status variant.
- Type mix in rows: merchant name sans + slug "mlp" mono; ORDER # mono; AWB mono + trailing bag/lock icon. Mono used ad hoc.
- Table is full-width here (~1020px) vs detail/edit pages locked to ~560px — list-vs-detail width inconsistency.
- Headers uppercase letter-spaced single-line; rows tall.

### admin-08 /admin/tasks/[id] (detail)  [shot: admin-08-task-detail.png]
- Same narrow ~560px FieldRow column; right half of viewport empty.
- STATUS RENDERED TWO WAYS on one page: "CREATED" pill top-right AND "COARSE STATUS: CREATED" as plain text row. Pick one Badge.
- MONO OVERUSE: dates, window, AWB, customer order #, SuiteFleet id all monospace; "subscription" + consignee "Zoro" sans. No rule.
- Delivery window shows full seconds "09:00:00 — 21:00:00" (should be 09:00–21:00). Time formatting not normalized.
- Empty-state "—" again on COURIER STATUS / REFERENCE # / ADDRESS LABEL.
- GOOD: consignee shows real name "Zoro" (not an ID) here.
- Buttons: VIEW TIMELINE (outline) + ← BACK TO TASKS (text link).

### admin-09 /admin/consignees  [shot: admin-09-consignees.png]
- LIKELY TEST-DATA INFLATION: "866 TOTAL CONSIGNEES" spans all tenants incl test (no genuine-merchant filter here; /admin/merchants shows only 8 genuine). Same leak family as Overview.
- PHONE NOT HUMANISED: raw E.164 "+971503333333" / "+97156888888" in the Phone column (known followup_phone_display_readability) — hard to read.
- CRM BADGE VARIANTS DIVERGE: "ACTIVE" = green fill pill; "CHURNED" = outline badge with STRIKETHROUGH text. Two badge constructions for one column.
- District data unnormalized: "Tecom" / "Al Quoz" / "al quoz" (lowercase) shown verbatim.
- Stat card = wide number-left style (866). Merchant cell = name + mono slug. Headers uppercase single-line. Names are real (good).
- Filters: native <select> MERCHANT + PER PAGE (same native-select inconsistency).

### admin-10 /admin/consignees/[id] (detail)  [shot: admin-10-consignee-detail.png]
- Repeats detail-page pattern: narrow ~620px left column, right half empty; uppercase letter-spaced labels.
- PHONE raw E.164 "+971503333333" (unhumanised).
- Empty-state "—" on EMAIL / MERCHANT REFERENCE / INTERNAL NOTES (3 empty rows).
- CREATED date mono "2026-06-20"; values otherwise sans.
- ACTIVE green pill top-right.
- Admin consignee detail has NO timeline/calendar (brief envisions one on merchant side) — fields only.

### admin-11 /admin/subscriptions  [shot: admin-11-subscriptions.png]
- *** CONFIRMS LOVE'S FLAG: CONSIGNEE column shows a raw 8-char UUID hash (c9fdc03c, 08d675d1, b1ccfd07, efa97a08, 5071ebd6, ad71e892) in MONO instead of the consignee NAME. (Row 1 c9fdc03c = "Zoro".) Should render the name. ***
- THIRD STATUS STYLE: here status = colored dot + text ("● ACTIVE" green / "● ENDED" gray / "● PAUSED" amber). On Consignees/Merchants status = filled/outline PILLS. No shared StatusBadge.
- NO COUNT STAT-CARD here, while Merchants/Tasks/Consignees each show a "TOTAL …" card. Inconsistent page-header pattern.
- CADENCE long & literal: "Mon, Tue, Wed, Thu, Fri, Sat, Sun" (7-day row) — no condensing (Daily / Mon–Fri).
- WINDOW "09:00 – 21:00" (no seconds) — but task DETAIL showed "09:00:00 – 21:00:00" (seconds). Time format differs across surfaces.
- MATERIALIZE action present on ACTIVE/PAUSED rows, ABSENT on ENDED row (conditional, blank cell).
- Merchant cell name + mono slug; headers uppercase single-line.

### admin-12 /admin/subscriptions/[id] (detail)  [shot: admin-12-subscription-detail.png]
- PROOF the list defect is fixable: detail resolves CONSIGNEE = "Zoro" (name) AND shows CONSIGNEE ID full UUID separately. The name is available; the LIST simply renders the id field. (Also: showing a raw full UUID "CONSIGNEE ID" to an operator is low-value.)
- DELIVERY WINDOW "09:00:00 — 21:00:00" (seconds) — but the subscriptions LIST showed "09:00 – 21:00" (no seconds). Time format inconsistent even within one entity.
- H1 is generic "Subscription" — no identifying detail (consignee/plan) in the heading.
- Empty "—" on PLAN NAME / EXTERNAL REFERENCE / PAUSED AT / ENDED AT (4 rows). ADDRESS shows label "Consignee default address" not a real address.
- DAYS OF WEEK full 7-day literal again. Narrow ~560px column. ACTIVE pill top-right. Mono dates.

### admin-13 /admin/users  [shot: admin-13-users.png]  *** confirms 3 Love flags ***
- BUTTON-SIZE MISMATCH (Love): "RESET PASSWORD" wraps to 2 lines → tall button; "DISABLE" is 1 line → short button. Same row, unequal heights/widths. No fixed Button sizing.
- "CREATED" DATE WRAPS (Love): "2026-05-" / "17" — column too narrow; date should never wrap.
- HEADER COLLISION: "STATUS" and "CREATED" headers butt together ("STATUS CREATED"); status dot+text overlaps the created column.
- EMAIL + FULL NAME WRAP: "transcorp-"/"admin@planner.test"; "Transcorp"/"Admin". Too many columns for width, no truncation/min-width rule.
- ROLE = raw slug ("tenant-admin", "transcorp-sysadmin") — not humanised ("Tenant Admin").
- "+ NEW USER" fits one line here, but "+ NEW MERCHANT" wrapped — same button, inconsistent results (width-dependent, not componentised).
- STATUS = green dot+text (matches subscriptions), differs from Consignees/Merchants pills.

### admin-14 /admin/users/[id] (detail)  [shot: admin-14-user-detail.png]
- WIDTH INCONSISTENCY: this detail is wide/centered ~900px; merchant/task/consignee/subscription details were narrow ~560px left. Detail pages don't share a width.
- ROLE HUMANISED HERE ("Tenant Admin") but RAW SLUG on the list ("tenant-admin"). List vs detail formatting mismatch.
- RESET PASSWORD + DISABLE are equal-size single-line here (room available) — same buttons that mismatched on the list. Proves buttons lack fixed min-width and reflow per context.
- BACK-LINK PLACEMENT INCONSISTENT: "← ALL USERS" at TOP here; other details put "← BACK TO X" at the BOTTOM.
- EMAIL mono, TENANT "Meal Up (mlp)" mono slug, CREATED mono date; EDIT outline button; LOGIN "● ACTIVE" green dot.

### admin-15 /admin/users/[id]/edit  [shot: admin-15-user-edit.png]  *** confirms Love's missing-EMAIL flag ***
- NO EMAIL FIELD (Love / product gap): EMAIL is read-only display text "mealup@test.com"; only FULL NAME (input) + ROLE (select) are editable. Cannot update a user's email anywhere.
- PRIMARY-BUTTON COLOR INCONSISTENT: "SAVE CHANGES" = dark NAVY filled; merchant edit/credentials primary = GREEN filled. No canonical primary color.
- READ-ONLY vs EDITABLE fields not visually distinguished: EMAIL/TENANT are plain text; FULL NAME is a boxed input; ROLE a native <select>. Form mixes display + input rows with no affordance cue.
- ROLE = native browser <select> again. Wide centered ~900px (matches user detail). "← CANCEL" text link.

### admin-16 /admin/users/new  [shot: admin-16-user-new.png]
- EMAIL editable at CREATE (input) but read-only at EDIT — asymmetry confirms the edit-email gap is a real omission, not a platform constraint.
- Primary "CREATE USER" = navy filled (consistent w/ user-edit navy; still differs from merchant-module green).
- TENANT + ROLE = native <select> (ROLE humanised "Transcorp Sysadmin" in the option text — yet list shows raw slug). Wide centered ~900px. Helper text under password.

### admin-17 /admin/asset-tracking  [shot: admin-17-asset-tracking.png]  *** confirms 2 Love flags ***
- "REFRESH NOW" BUTTON-SIZE MISMATCH (Love): wraps to 2 lines ("REFRESH"/"NOW") next to long name "Meal Plan Scheduler"; stays 1 line next to "Meal Up". Button shares the merchant cell, so name length deforms it. No fixed button width + bad cell composition.
- TABLE HEADERS WRAP TO 2 LINES (Love): "ASSETS"/"ALLOCATED", "SUPP."/"QTY", "EN"/"ROUTE", "MERCHANT / DELIVERY DATE". Columns too narrow for labels; no nowrap/abbreviation rule.
- FILTER LAYOUT UNBALANCED: DATE RANGE custom dropdown + 2 native date inputs on the left; MERCHANT native <select> stranded far-right with a large empty gap between.
- Subtitle verbose: "As of Mon, 22 Jun 2026 12:25:54 UTC" (full seconds + UTC).
- Mixed control styles again (custom range dropdown vs native date inputs vs native select).
- Lots of low-contrast gray zeros across COLLECTED/RECEIVED/SORTED/EN ROUTE/RETURNED.

### admin-18 /admin/asset-tracking/log  [shot: admin-18-asset-tracking-log.png]
- EMPTY-STATE INCONSISTENCY: here a proper bordered card w/ guidance ("Open this log from an Allocated Asset count…") — good. But detail pages use bare "—" and lists show nothing. Three different empty-state treatments across the app; no EmptyState component.
- BACK-LINK STYLE VARIANCE: "← Back to Asset Tracking" = underlined sentence-case; detail pages use uppercase letter-spaced "← BACK TO X". Two link styles.
- Title "Asset Log" sentence case (vs many uppercase eyebrows). Content centered-wide.

### admin-19 /admin/inventory  [shot: admin-19-inventory.png]  *** confirms Love's inventory flag ***
- NAMES WRAP TO 2 LINES (Love: should fit one line): "Meal Plan / Scheduler", "Meal / Up".
- MERCHANT CELL CRAMMED + MISALIGNED: ▸caret + 2-line name + "(N consignees)" + REFRESH NOW button all in one cell; the REFRESH NOW buttons do NOT align row-to-row (different x per row) and both wrap to 2 lines.
- GRAMMAR BUG: "(1 consignees)" — no singular/plural handling.
- TABLE HEADERS WRAP: ASSETS/ALLOCATED, SUPP./QTY, EN/ROUTE (same as Asset Tracking).
- DUPLICATION: Inventory ≈ Asset Tracking (same columns + filter); Inventory adds expandable rows + consignee counts. Two near-identical report surfaces.
- Same unbalanced filter row (date inputs left, MERCHANT select far-right).

### admin-20 /admin/regions  [shot: admin-20-regions.png]
- TEST/SYNTHETIC DATA: "74 TOTAL REGIONS", nearly all identically named "ACD OAuth Region" w/ synthetic client IDs (acdaecdaedb…). Same test-data-leak family as Overview/Consignees.
- "+ NEW REGION" HEADER BUTTON WRAPS to 2 lines ("+ NEW"/"REGION") — same as "+ NEW MERCHANT"; "+ NEW USER" did NOT wrap. Header action button has no min-width, wraps when title is wide.
- STATUS = green PILL here (vs dot+text on Subscriptions; raw-slug none) — pill/dot styles still split by surface.
- DEACTIVATE outline single-line (fits; name column wide). CLIENT ID mono. AUTH METHOD plain. Stat card = wide number-left (74). Headers uppercase single-line.

### admin-21 /admin/regions/[id] (detail)  [shot: admin-21-region-detail.png]
- RECURRING COMPONENT BUG: "AUTH METHOD" value (OAUTH) is indented further right than CLIENT ID/DISPLAY NAME/CREATED values — SAME misalignment as merchant-detail AUTH METHOD. The AUTH METHOD value cell carries stray left padding wherever it's used.
- WIDTH: wide centered ~900px (like user detail) — vs narrow ~560 merchant/task/consignee/subscription details. Detail pages split into 2 width families.
- ACTIVE pill + DEACTIVATE outline; CLIENT ID mono; helper "Immutable…"; "← BACK TO REGIONS" uppercase bottom link.

### admin-22 /admin/regions/new  [shot: admin-22-region-new.png]
- ONE-OFF INPUT PATTERN: AUTHENTICATION METHOD uses radio-CARDS (bordered card + radio + title + desc) — nicer than native selects, but used nowhere else (user/merchant forms use native <select>). Input patterns not unified.
- PRIMARY GREEN here ("CREATE REGION") — confirms primary color splits by module: Merchants+Regions = green, Users = navy.
- Wide centered ~900px; placeholders concrete (transcorpuae / Transcorp UAE); CANCEL text link.

## ADMIN — MOBILE (390×844)

### admin-13 /admin/users (MOBILE 390)  [shot: admin-13-users-mobile.png]
- TABLES NOT RESPONSIVE: table overflows right edge; columns past TENANT off-screen, requires horizontal scroll; no card/stack layout for narrow screens.
- TOP BAR CLIPS: logo + "SUBSCRIPTION PLANNI[NG]" wordmark cut off at right edge.
- NAV WRAPS to 3 rows (functional but cramped). "+ NEW USER" goes full-width (ok). FULL NAME header wraps.

### admin-11 /admin/subscriptions (MOBILE 390)  [shot: admin-11-subscriptions-mobile.png]
- Same table overflow (columns past CADENCE off-screen). CONSIGNEE hash persists. CADENCE wraps to 4 lines. No responsive table.

### admin-19 /admin/inventory (MOBILE 390)  [shot: admin-19-inventory-mobile.png]
- Report table overflows (only MERCHANT column visible). Filter row stacks (ok). Merchant cell crams name + (N consignees) + REFRESH NOW. Same non-responsive table.

## MERCHANT (logged in as mpl-admin = Meal Up / mlp)

### merchant-02 /tasks  [shot: merchant-02-tasks.png]
- DESKTOP HORIZONTAL OVERFLOW: table wider than 1440 viewport — TEL column clipped at right edge even on desktop (cols: checkbox/DATE/AWB/STATUS/CONSIGNEE/ADDRESS/DISTRICT/EMIRATE/TEL...). Too many columns, no priority/hide strategy.
- STAT CARD holds a CONTROL: "PER PAGE 50" select sits INSIDE the TOTAL TASKS stat card (right side). On admin tasks, per-page was in the filter row. Inconsistent placement.
- STATUS split again: "CREATED" w/ icon-badge; "CANCELLED" bare gray text.
- NAV JARGON for operators: top-level "Failed pushes" + "Webhook config" (+ "Inventory") — system/dev vocabulary surfaced to a merchant operator (violates "name by what users control").
- AWB cell stacks mono AWB + green "✓ PUSHED TO SUITEFLEET" sub-line. ADDRESS truncates w/ ellipsis (good). Consignee = real names (good).
- Mixed dropdowns (native STATUS select vs custom TODAY dropdown). "PRINT LABELS" outline btn (disabled until selection).

### merchant-01 / (home "Welcome back")  [shot: merchant-01-home.png]
- TERMINOLOGY DRIFT for one entity: "consignee" (nav/card title) vs "subscriber" ("Subscriber base") vs "merchant subscriber" ("Start a new merchant subscriber…"). Pick one noun.
- REDUNDANT EYEBROW: every shortcut card stamped "SHORTCUT" — noise.
- NO DATA on the merchant "home": just 4 nav shortcut cards (Onboard new consignee / Subscriber base / Today's deliveries / Today's tasks). Admin Overview is data-rich; merchant home is not — inconsistent dashboard philosophy + a missed at-a-glance opportunity.
- "VIEW →" uppercase link action; airy cards; 2-col grid uses width reasonably.

### merchant-03 /calendar ("All deliveries")  [shot: merchant-03-calendar.png]
- CONSISTENCY WIN: 5-card stat grid (ACTIVE CONSIGNEES/TODAY'S DELIVERIES/DELIVERED/OUT FOR DELIVERY/FAILED pink) matches admin Overview's stat cards. Best-designed surface.
- WEEK/MONTH/DAY segmented control (good). Calendar month grid.
- Minor: day cells show date "01" then a bare "1" (delivery count) with NO unit/label — ambiguous. MON/TUE headers uppercase gray.
- 3 native <select> filters (All CRM states / All areas / All statuses). Nav: "← PREVIOUS | THIS MONTH | NEXT →" pipe-separated text links.
- "ACTIVE CONSIGNEES 213" for one tenant — possibly in-tenant test inflation (watch).

### merchant-04 /consignees  [shot: merchant-04-consignees.png]
- IN-TENANT TEST/SEED DATA visible to a REAL operator: "215 TOTAL CONSIGNEES" includes a consignee named "Test 1" + many rows with identical phone (+971501122334) and identical address ("Warehouse 23/24, Al Quoz Industrial 1"). Junk seed data in production merchant view.
- PRIMARY BUTTON = NAVY FILLED "ONBOARD NEW CONSIGNEE" (admin used OUTLINE "+ NEW MERCHANT"); also verbose label. Primary style differs admin vs merchant.
- CRM STATE "ACTIVE" green pill (matches admin). PHONE raw E.164. Subtitle reuses "Subscriber base".
- Table fits at 1440 (5 cols, no merchant col). ADDRESS not truncated here (full).

### merchant-05 /consignees/[id] (detail, tabbed)  [shot: merchant-05-consignee-detail.png]
- *** MAJOR CROSS-AREA INCONSISTENCY: merchant detail ≠ admin detail. Here: TABS (Overview/Subscription/Calendar/History) + 2-COLUMN field grid + SENTENCE-CASE labels ("Name","Phone","Email","District"). Admin detail = single-column FieldRows + UPPERCASE letter-spaced labels, no tabs. Two unrelated detail-page systems. ***
- Buttons: EDIT / NEW SUBSCRIPTION / ADD AD-HOC TASK / CHANGE STATE / ADD ADDRESS — all outline; ACTIVE + PRIMARY pills. Rich action set (good) but many outline buttons of varying widths.
- Phone raw E.164; Email seed "test@test.com". "← CONSIGNEES" uppercase top back-link. Tabs underline-active green.
- This realizes the brief's "consignee detail with calendar" (Calendar tab) — the only place tabs are used in the app.

### merchant-06 /consignees/[id]/edit  [shot: merchant-06-consignee-edit.png]
- LABEL CASING INCONSISTENT WITHIN ONE ENTITY: edit form labels UPPERCASE ("FULL NAME","PRIMARY PHONE","EMAIL"); the consignee DETAIL page used SENTENCE case ("Name","Phone","Email"). Same entity, two label systems.
- GREEN vs NAVY within merchant area: SAVE CHANGES = green filled; but consignee LIST's "ONBOARD NEW CONSIGNEE" = navy filled. Inconsistent primary color even inside merchant.
- GOOD: right-aligned "OPTIONAL" tags on optional fields; helpful helper text ("Visible to drivers." / "Not visible to drivers.").
- Narrow ~590px left column (right empty); CANCEL text link; phone E.164 + helper.

### merchant-07 /consignees/new ("Onboard new consignee")  [shot: merchant-07-consignee-new.png]
- Single long form (brief's "onboarding wizard" is NOT stepped — one page). Uppercase labels (consistent w/ edit form). Green "CREATE CONSIGNEE" primary.
- ADDRESS LABEL native <select>. Concrete placeholders; good helper text. Narrow ~480px left column; right empty. CANCEL text link.

### merchant-08 /subscriptions  [shot: merchant-08-subscriptions.png]
- *** PROVES ADMIN HASH IS A BUG: merchant subscriptions list shows CONSIGNEE = NAME as a clickable LINK ("Fatima Al Mansouri","Roudy M","Toufic"). Admin's same list shows the UUID hash. The correct rendering exists; admin uses the wrong field. ***
- "225 TOTAL SUBSCRIPTIONS" — in-tenant seed inflation (cf. 215 consignees).
- STATUS = dot+text (● ACTIVE/PAUSED) — matches admin subscriptions (consistent within this entity).
- "NEW SUBSCRIPTION" = NAVY filled (merchant uses navy for list actions, green for form saves — internal split).
- WINDOW no seconds (09:00–21:00); headers uppercase single-line; no actions column (merchant view).

### merchant-09 /subscriptions/[id] (detail)  [shot: merchant-09-subscription-detail.png]
- Rich/dense detail (vs admin's sparse FieldRows): DAY CHIPS (MON/TUE/WED filled, SAT/SUN outline) for delivery days — but admin shows "Mon, Tue, Wed…" TEXT. Component divergence (chips vs text) for the same data.
- TEST-ARTIFACT NAME in prod: subscription titled "UAT R4/R5 address-override probe (Day-53)" shown to operator.
- TASKS table mixes 3 status styles: CREATED (icon), ASSIGNED (amber badge), DELIVERED (green badge+icon). Same StatusBadge gap.
- RECENT EXCEPTIONS rows show raw mono hash (8f33b3b…) + full timestamp — technical noise to an operator.
- LIFECYCLE as a bordered card w/ PAUSE SUBSCRIPTION btn; AWB mono + green "✓ PUSHED TO SUITEFLEET"; "CALENDAR" link per task row. Very long page.

### merchant-10 /subscriptions/[id]/edit  [shot: merchant-10-subscription-edit.png]
- DAY-CHIP TOGGLE (good interactive component) — but it's the ONLY place chips are used as inputs; nowhere else.
- ACTION PLACEMENT AWKWARD: CANCEL/SAVE CHANGES sit MID-PAGE, then a separate LIFECYCLE "Pause subscription" card renders BELOW the actions. Primary actions aren't at the page bottom.
- Native date + time inputs (OS chrome) among custom fields. "OPTIONAL" tags (good). SAVE CHANGES green. PLAN NAME = test artifact "UAT R4/R5…". Centered ~580-880.

### merchant-11 /subscriptions/new ("New subscription")  [shot: merchant-11-subscription-new.png]
- BEST-DESIGNED SURFACE: mode segmented control (RECURRING | SINGLE AD-HOC TASK), CADENCE preset chips (MON-FRI / MON-WED-FRI / WEEKEND / DAILY / CUSTOM) + day chips, live PREVIEW card ("Will create 23 deliveries over next 31 days"). Strong patterns.
- These good patterns are ONE-OFFS: segmented control (also calendar), chips (sub detail/edit), preview card (only here) — not reused; native <select> used for CONSIGNEE here + most other forms.
- Cadence presets PROVE condensing exists ("MON-FRI") — admin subscriptions list still shows verbose "Mon, Tue, Wed, Thu, Fri".
- Native date/time inputs; OPTIONAL tags; green CREATE SUBSCRIPTION; centered ~470px column.

### merchant-12 /reports/inventory  [shot: merchant-12-reports-inventory.png]  *** Love's "1 date/2 date misaligned" ***
- "(N date)" LABELS MISALIGNED (Love): "By consignee" table CONSIGNEE cell = ▸caret + name (wraps 2 lines) + "(1 date)" gray; the "(1 date)" sits at inconsistent vertical positions. Name wraps ("Fatima Al / Mansouri").
- TABLE HEADERS WRAP again (ASSETS/ALLOCATED, SUPP./QTY, EN/ROUTE).
- REPORT DUPLICATION (3rd time): merchant /reports/inventory ≈ admin /inventory ≈ admin /asset-tracking (same columns; two tables "By delivery date" + "By consignee").
- "REFRESH NOW" outline btn floated right with a large gap; same unbalanced filter row (date inputs left).

### merchant-13 /admin/failed-pushes  [shot: merchant-13-failed-pushes.png]
- HEAVY ENGINEER JARGON to an operator: "OPERATIONS · DLQ", "dead-letter queue", "bulk retry paces at 5 requests per second so SuiteFleet doesn't get hammered", "when the cron writes a DLQ row". Names the system internals, not what the user controls. (Whole surface speaks engineer.)
- EMPTY-STATE STYLE #4: plain centered text "No unresolved failed pushes." (no card) — vs asset-log bordered card, vs detail "—", vs list-nothing. No EmptyState component.
- Stat card wide number-left "0 UNRESOLVED ROWS"; "View resolved →" underlined sentence-case link.

### merchant-14 /admin/failed-pushes/resolved  [shot: merchant-14-failed-pushes-resolved.png]
- RAW DB DUMP: TASK column = full UUID wrapping to 3 LINES per row (mono); RESOLVED AT / FIRST FAILED = full "…UTC" timestamps wrapping to 3 lines; FAILURE = raw enum codes ("client_4xx","past_dated"). Rows hugely tall from wrapping.
- HEADERS WRAP: "RESOLVED"/"AT", "FIRST"/"FAILED".
- Same "OPERATIONS · DLQ" jargon eyebrow. NOTES seed "test". Stat card "32 RESOLVED ROWS".

### merchant-15 /admin/webhook-config  [shot: merchant-15-webhook-config.png]
- DOC-STYLE TECHNICAL PROSE to an operator: "OPERATIONS · INTEGRATIONS", Tier-1/Tier-2 verification explainer ("verifies header credentials via timing-safe comparison", "body conforms to SuiteFleet's known shape").
- DEV LANGUAGE IN UI: "Other receiver metrics … are deferred to a future commit." — roadmap/commit language surfaced to users. Also "Coming soon: credential management."
- RECEIVER URL wraps to 2 lines inside its boxed field (same as merchant-detail webhook box). Long prose blocks, weak visual hierarchy (just hairline rules). Content ~640px left; right empty.

## MERCHANT — MOBILE (390×844)

### merchant-02 /tasks (MOBILE 390)  [shot: merchant-02-tasks-mobile.png]
- Stat card crams number + "TOTAL TASKS" (wraps) + "PER PAGE" + select on one mobile row. Top bar clips ("SUBSCRIPTION PLANNI"). Nav wraps to 4 rows. Table overflows below. Filters stack (ok).
