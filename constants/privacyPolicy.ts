/**
 * The Privacy & Data notice — the SINGLE source the in-app page renders
 * (components/PrivacyNotice.tsx). Edit the text here; nothing in JSX holds it.
 *
 * Bump POLICY_VERSION whenever the text changes in substance: every user whose
 * users.policy_version differs sees the one-time "updated notice" card on next
 * open and their acknowledgement is recorded (acknowledge_policy RPC).
 *
 * Text is the owner's draft (Tasks/PRIVACY_POLICY_DRAFT.md, 2026-10-11),
 * minus its draft banner and its "Notes for Aderfia" section. Values in
 * `[BRACKETS]` are decisions only Aderfia can make; while any remain the page
 * shows a "Draft" marker (POLICY_IS_DRAFT). ⚠️ The draft asks for review by
 * someone qualified in Indian data-protection and employment law before it
 * ships — do not remove the marker by deleting placeholders without that.
 *
 * Statements in here that the CODE must keep true (read before touching):
 *   §3  no location outside punch-in → punch-out (lib/dutyLocation.ts)
 *   §4  spot-sale faces blurred on the phone, fail-closed (lib/faceBlur.ts);
 *       spot-sale photos deleted after 90 days (pg_cron purge-spot-sale-photos)
 *   §6  SMs cannot see each other's field data (RLS, 2026-10-09);
 *       every live-location view is logged (location_requests)
 *
 * Markdown subset understood by the renderer: #/## headings, paragraphs,
 * "- " bullets, | tables |, **bold** and `placeholder` spans.
 */
export const POLICY_VERSION = '1.0';
/** null until the owner sets it — the page then says "not yet set". */
export const POLICY_EFFECTIVE_DATE: string | null = null;

export const POLICY_MARKDOWN = `## 1. Who we are

TankAssist is operated by \`[ADERFIA VENTURES — FULL REGISTERED ENTITY NAME]\`, \`[REGISTERED ADDRESS]\`
("the Company", "we"). For the purposes of the Digital Personal Data Protection Act, 2023, the
Company is the Data Fiduciary for the personal data described in this notice.

## 2. Why this notice exists

TankAssist records where you are during working hours, photographs you take as part of your work, and
the distance you travel. We think you are entitled to know exactly what is collected, why, who can
see it, and how long we keep it. This notice sets that out in plain terms.

## 3. What we collect

**Your account**
Name, mobile number, \`[email address]\`, your role, which manager you report to, and whether your
account is active.

**Attendance and travel**
The time you punch in and out each working day. Your odometer reading at the start and end of the
day, and the photograph of the odometer you take to record it. The distance you travelled, calculated
both from those readings and from your route.

**Location**
- The GPS coordinates recorded when you check in and out of a store.
- Your position every few minutes during the working day, between punch-in and punch-out, so your
  manager can see where you are working. Your route for the day is worked out from your punch-in and
  store check-in positions.
- Your location when your manager looks it up. While you are punched in they see your live position.
  After you punch out they see only the last position recorded during your working day — nothing new
  is collected to answer them.

**We do not collect your location outside your working day.** Location recording begins when you
punch in and stops when you punch out or when the system closes your day automatically.

**Photographs you take at work**
Your check-in photograph, photographs of store shelves and displays, delivery challan photographs,
odometer photographs, and spot-sale photographs.

**Your work record**
Store visits and how long you spent at each, stock counts you record (or the reason you could not
count), orders you place, spot sales you log, your journey plans, and delivery records.

**Integrity checks**
The app automatically checks for signs that recorded work did not happen as described — for example
if your device reports a simulated GPS location, if a recorded movement between two points is
physically impossible, if the same store appears twice under different names, or if spot sales are
logged in a pattern that does not match how the store's stock moved. These checks raise a
flag for your manager to look at. **A flag is not an accusation and does not by itself result in any
action against you.**

**Your device**
A notification token so we can send you alerts, and \`[basic device and operating-system information]\`
needed to deliver them.

## 4. Photographs of customers

When you record a spot sale, the photograph may include a member of the public.

**Faces in these photographs are automatically blurred on your phone, before the photograph is
uploaded.** The unblurred original is never sent to us and is not saved to your phone's gallery. Only
the blurred image reaches our systems. If your phone cannot check a photograph for faces, that
photograph is not saved at all.

We do this because a customer in a liquor shop has not agreed to anything, and a photograph of a
person buying alcohol is sensitive. We do not want to hold it and you should not have to take it.

When taking these photographs, frame the product and the counter. A face is not needed and should be
avoided where possible.

Spot-sale photographs are **automatically deleted after 90 days.** The record of the sale is kept;
the image is not.

## 5. Why we collect it

| What | Why |
|---|---|
| Attendance times | To record your working days and calculate pay |
| Odometer readings and photographs | To calculate and verify your travel allowance |
| Location during working hours | To confirm store visits, calculate your route and travel distance, and plan journeys |
| Store photographs and stock counts | To record the state of the market and how our products are stocked and selling |
| Spot-sale records | To recognise selling work that would otherwise leave no record |
| Order and delivery records | To run the business — supplying stores and tracking deliveries |
| Integrity checks | To keep travel-allowance and performance records accurate and fair to everyone |
| Notification token | To send you alerts about your work |

Under Section 7 of the Digital Personal Data Protection Act, 2023, we process this data as a
legitimate use for employment purposes — \`[CONFIRM THIS BASIS WITH COUNSEL; some processing may
require consent]\`.

## 6. Who can see your data

| Who | What they can see |
|---|---|
| You | Everything recorded about your own work |
| Your manager | Your work record — visits, attendance, travel, photographs, flags |
| Management | All records across the company |
| Other sales managers | **Nothing of yours.** A sales manager cannot see another sales manager's field data |
| Your colleagues | Nothing of yours |

Shared operational records — store orders, stock levels and delivery photographs — are visible to
whoever needs them to serve that store, because a colleague may complete a delivery you started.
Personal records are not shared this way.

**Every time a manager views your live location, the system records who looked and when.** That
record exists to make sure the feature is used proportionately.

## 7. How long we keep it

| What | Kept for |
|---|---|
| Spot-sale photographs | 90 days, then deleted automatically |
| Other work photographs | \`[PROPOSE: 12 months]\` |
| Location and route records | \`[PROPOSE: 12 months]\` |
| Attendance and travel-allowance records | \`[PROPOSE: as required by payroll and tax law — confirm the statutory period]\` |
| Store visits, orders, stock counts | \`[PROPOSE: retained as business records]\` |
| Your account | For as long as you work with us, plus \`[PERIOD]\` |

## 8. Your rights

You may:
- **Ask what we hold about you** and get a summary of it.
- **Ask us to correct** anything inaccurate, incomplete or out of date.
- **Ask us to erase** your personal data, where we are not required to keep it for a legal or
  business reason.
- **Nominate** someone to exercise these rights on your behalf if you are unable to.
- **Raise a grievance** with us, using the contact below.

To exercise any of these, contact \`[GRIEVANCE OFFICER NAME]\` at \`[EMAIL]\` / \`[PHONE]\`. We will
respond within \`[PERIOD — propose 30 days]\`.

If you are not satisfied with how we handle your grievance, you may complain to the **Data Protection
Board of India**.

## 9. What we do not do

- We do not track your location outside your working hours.
- We do not read your messages, calls, contacts, or anything else on your phone.
- We do not use your photographs for advertising or share them outside the Company.
- We do not sell your data to anyone.
- We do not use automated decisions alone to take disciplinary action. Flags raised by the app are
  reviewed by a person.

## 10. Security

\`[DESCRIBE: access is restricted by role and enforced by the database; photographs are stored in
access-controlled storage; add anything else true — encryption in transit, who holds administrative
access.]\`

## 11. Changes to this notice

If we change this notice we will update the version and date above, and the app will show you the new
version the next time you open it. \`[STATE whether continued use constitutes acknowledgement, or
whether an explicit acknowledgement is required — this should be a deliberate choice.]\`

## 12. Contact

\`[GRIEVANCE OFFICER / DATA PROTECTION CONTACT NAME]\`
\`[EMAIL]\` · \`[PHONE]\`
\`[ADERFIA VENTURES — REGISTERED ADDRESS]\``;

/** True while any owner decision is still an unfilled `[PLACEHOLDER]`. */
export const POLICY_IS_DRAFT = /\[[A-Z]/.test(POLICY_MARKDOWN) || POLICY_EFFECTIVE_DATE == null;
