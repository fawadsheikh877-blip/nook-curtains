# Nook Curtains: customer page and staff desk

Two pages on one Netlify site:

| Address | Who uses it | What it is |
|---|---|---|
| `/` | Customers | "Book your free estimate" form. Sends the request to your inbox in the desk, or opens WhatsApp. |
| `/desk/` | Staff | Password-protected desk: customer requests, jobs, measurements, quotes, appointments, prices, invoices. |

Data is stored in Netlify Blobs, which is built into Netlify. There is no database to set up and no extra account.

## 1. Choose three secrets

Add these as environment variables in Netlify (step 3). Pick your own values.

| Name | What it is |
|---|---|
| `STAFF_PASSWORD` | Shared password for staff. Can use everything except prices, invoice details and backups. |
| `ADMIN_PASSWORD` | Password for the owner or manager. Same as staff, plus prices, invoice details (TRN) and "Download backup". Must differ from the staff password. |
| `AUTH_SECRET` | Long random text, at least 32 characters, used to sign the login cookie. Make one with `openssl rand -hex 32`, or type 40 random characters. |

## 2. Put the project on Netlify

**Recommended: through GitHub**
1. Create a free GitHub account and a new private repository.
2. Unzip this project and upload its contents to the repository, so that `netlify.toml` sits at the top level.
3. In Netlify choose **Add new site, Import an existing project**, and pick the repository. Leave the build command empty. The publish folder (`public`) and functions folder are read from `netlify.toml`.

**Alternative: Netlify CLI** (from this folder)
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```
Pick "Create & configure a new project" the first time.

Drag-and-drop deploys are not recommended. They publish the pages, but I could not confirm that they also build the API functions and install their packages.

### If the deploy says `directory 'public' does not exist`

Netlify is looking in a folder that has no `public` folder inside it. Open your GitHub repository's main page. At the top level you must see these three folders and three files:

```
netlify/   public/   scripts/   netlify.toml   package.json   README.md
```

- **You see only one folder** (for example `nook-curtains-netlify`): you uploaded the folder instead of what is inside it. Either upload again with the files at the top level, or in Netlify open **Site configuration, Build & deploy, Continuous deployment, Build settings**, set **Base directory** to that folder's name, keep **Publish directory** as `public`, save, and trigger a new deploy.
- **You do not see `public/`, `netlify/` or `scripts/`:** GitHub's "choose your files" button uploads loose files only. Drag the folders themselves into the upload page, or use GitHub Desktop.
- **Using the CLI:** run the command from inside the folder that contains `netlify.toml`. If it asks for a publish directory, enter `public`.

## 3. Add the secrets, then deploy

In Netlify open **Site configuration, Environment variables** and add `STAFF_PASSWORD`, `ADMIN_PASSWORD` and `AUTH_SECRET`. Then trigger a new deploy (Deploys, Trigger deploy), because variables only apply to deploys made after they are set.

## 4. First-deploy check (2 minutes)

1. Open `https://YOUR-SITE.netlify.app/api/health`. You should see `"ok": true`. If a setting is missing it says which one.
2. Open `https://YOUR-SITE.netlify.app/desk/` and sign in with the admin password.
3. In the same browser, open `https://YOUR-SITE.netlify.app/api/health?deep=1`. Every step under `deep` should say `"ok": true`. This tests each storage call the app relies on.
4. Open the customer page `/`, send a test request, and check it appears in the desk under "New customer requests". Then press Dismiss.
5. In the desk, Prices tab: add your real items and rates, and fill in your TRN.

## Using it

- **Customers:** link to `/` from the website's "Get a free quote" button, WhatsApp and Instagram. The form's main button sends the request to the desk. WhatsApp and Copy message remain as alternatives.
- **New requests** show at the top of the Jobs list. "Create job" turns one into an enquiry with the details filled in.
- **Quotation, terms and signature:** once a job has priced windows or items, a *Customer approval* section appears. *Download quotation* saves a quotation with the terms and conditions and a signature box (customer and Nook Curtains). Print it, have the customer sign, then press *Record signature*. The order is then locked: items, sizes and prices cannot be edited. To change something later, press *Unlock to make a change*, enter the *Change fee* and what changed, then *Lock again*. The fee is added to the total (and to VAT) and shows on the quotation, invoice and the spreadsheet export. The invoice carries the same terms and signature box.
- **Terms and conditions wording:** the admin can edit it in the Prices tab, under Invoice details (one point per line). Clear the box to return to the standard wording. Have the wording checked to suit your business. The locking is a reminder inside the app. The signed paper copy is what the customer agreed to.
- **Messages from WhatsApp or email:** "Paste a customer request" still works for any message that has `Name:` and `Phone:` lines.
- **Invoices:** when a job reaches "Fabric confirmed", an Invoice section appears. "Download invoice" saves a file. Open it and press Print, or choose Save as PDF in the print window. The admin can untick **Charge 5% VAT** (Prices tab, Invoice details) if the business is not VAT-registered; quotes and invoices then show no VAT line. With VAT on and a TRN set the document is titled "Tax invoice". Invoice numbers are suggested (date plus a job code) and can be edited. They are not strictly sequential.
- **Data menu** (top right of the desk):
  - *Export jobs (spreadsheet)* and *Export windows and items*: CSV files that open in Excel or Google Sheets. Staff and admin can use them, online or offline.
  - *Download backup* (admin): everything in one `.json` file. Do this weekly and keep the file somewhere safe.
  - *Restore from backup* (admin): pick a backup file. The desk shows what is in it, saves a copy of the current data first, then replaces the data with the file. Needs a connection. Files up to 5 MB.

## Dashboard, payments and reports

- **Dashboard** (everyone): open jobs, today's visits, new requests, what needs attention, jobs by stage. The owner (admin) also sees money: collected this month, still to collect, orders won, quotes waiting.
- **Payments and deposits** (inside each job): record a deposit, instalments and the final payment with date, method and note. The invoice shows the payments received and the balance. The standard deposit percentage is set by the admin in the Prices tab, under Invoice details (default 50%).
- **Payments tab** (admin): balances still to collect, orders with no deposit yet, recent payments, and a spreadsheet export.
- **Reports tab** (admin): pick a period, then see enquiries, orders won, conversion, collected, lost jobs, sales by category and item, enquiry sources, payments by method and a month-by-month table. Download it as a spreadsheet.
- The Payments and Reports tabs are hidden from staff accounts. This is a screen-level separation: staff sessions can still read job data through the API, so do not treat it as a security boundary.
- A deposit typed in the old single Deposit box is kept and shows as an undated payment called Earlier.

## Working offline

- Open the desk (and the customer page) once with a connection on each phone or computer. After that both open without internet.
- Offline, the desk shows the data as it was when last online. New and changed jobs are kept on that device and sent automatically when the connection returns. A note at the bottom left says what is happening.
- If two people change the same job while one is offline, the last one to sync wins for that job.
- The saved copy is removed when you press Sign out. Signing out with unsynced changes asks first, because those changes would be lost.
- A device that has not been online for 7 days must connect and sign in again.
- Not available offline: backup, restore, receiving new customer requests, and the customer form (it tells the customer to try again or use WhatsApp).
- Anyone who can open the browser on a signed-in device can read its saved copy, so sign out on shared computers.

## Good to know

- The desk checks for changes from other people every 20 seconds, and when you return to the tab. If two people edit the same job at the same moment, the last save wins for that job.
- Each check is one call to the API function. Look at Netlify's current pricing for your plan if several people keep the desk open all day. The interval is `POLL_MS` near the top of the script in `public/desk/index.html`.
- Limits: 5,000 jobs, 500 price items, 300 unanswered requests. Delete finished jobs after a backup.
- Passwords are shared. When someone leaves, change the password. Changing `AUTH_SECRET` as well signs everyone out.
- After 10 wrong passwords an address is locked out for 15 minutes. The customer form allows 6 sends a minute per address and has a hidden field that catches spam bots.
- The form tells customers their details are stored. If you want a privacy policy link there, add it to `public/index.html`.
- Business details (address, phone, email) are written into `public/index.html` and into the invoice in `public/desk/index.html`.

## Try it on your computer first

Needs Node 18 or newer.
```
node scripts/dev-server.mjs
```
Open http://localhost:8888 (customer page) and http://localhost:8888/desk/ (staff desk). Preview passwords are `staff` and `admin`. Data is kept in memory and disappears when you stop it.

`node scripts/api-test.mjs` runs the API tests.

## Files

```
netlify.toml                  Netlify settings and security headers
package.json                  one dependency: @netlify/blobs
public/logo.png, logo-mark.png  logo files (replace them to change the logo)
public/sw.js                  lets the pages open offline
public/index.html             customer page
public/desk/index.html        staff desk
netlify/functions/api.mjs     staff API (login, jobs, prices, settings, backup, health)
netlify/functions/submit.mjs  public endpoint for the customer form
netlify/lib/                  storage, login and input checks
scripts/                      local preview and tests
```
