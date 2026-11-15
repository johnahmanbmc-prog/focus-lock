# Focus Lock setup guide for the helper

This is for the person who sets up Focus Lock on Yahya's laptop and keeps the admin password. It takes about 30 minutes, plus a few days of waiting for the Chrome Web Store review in step 4.

When it's done:

- Yahya uses a **standard** Windows account. Only the admin account can uninstall Focus Lock, stop its service, or change or delete its files.
- The Focus Lock app is installed in `C:\Program Files\Focus Lock`, and its settings are in `C:\ProgramData\FocusLock`. Standard users can read them but can't change or delete them.
- Chrome and Brave install the extension themselves through browser policy, and it can't be removed or turned off. Incognito and guest windows are turned off, and so are Brave's Tor windows.

Yahya still changes his own hours, lists and strict mode in the app. The Focus Lock service applies the rules: looser changes wait 24 hours, and none are allowed during strict mode.

## 1. Make the admin account (helper)

Sign in to Yahya's laptop with the account that is currently an administrator.

1. Open **Settings > Accounts > Other users > Add account**.
2. Choose **I don't have this person's sign-in information**, then **Add a user without a Microsoft account**.
3. Name it, for example `FocusAdmin`. Pick a strong password and keep it to yourself.
4. Back in **Other users**, select the new account, click **Change account type**, and pick **Administrator**.

## 2. Make Yahya's account standard

1. Sign out, then sign in as `FocusAdmin`.
2. Open **Settings > Accounts > Other users**. Select Yahya's account, click **Change account type**, and pick **Standard User**.

From now on, when something needs admin rights, Windows asks for the `FocusAdmin` password. Only you type it.

## 3. Install Focus Lock

1. Download **FocusLock-windows** from the latest successful run of the **test** workflow in the repo's Actions tab, and unzip it.
2. Run `FocusLock-Setup-<version>.exe`. When Windows asks, enter the `FocusAdmin` password.
3. The installer:
   - puts the app in `C:\Program Files\Focus Lock`,
   - creates `C:\ProgramData\FocusLock` where only admins can change files,
   - installs and starts the **Focus Lock** Windows service. It starts with Windows and restarts if it stops.
4. Check it worked: open **Services** (`services.msc`). **Focus Lock** should show **Running** and **Automatic**.

## 4. Publish the extension to the Chrome Web Store (one time)

On a normal (not company-managed) Windows PC, Chrome and Brave only force-install extensions that come from the Chrome Web Store. So the extension needs to be on the store. It can be **unlisted**, which means only people with the link can find it.

1. Go to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) and sign up. There is a one-time US$5 fee.
2. Click **New item** and upload `dist-extension.zip` from the same FocusLock-windows download.
3. Fill in the listing: a short description, one screenshot, and the privacy tab. For the privacy tab, say it reads page addresses and titles to block sites, and sends nothing anywhere. Set **Visibility** to **Unlisted**.
4. Submit for review. Reviews usually take a few days.
5. When it's approved, copy the 32-letter **Item ID** from the dashboard. It looks like `abcdefghijklmnopabcdefghijklmnop`.

## 5. Lock the extension into Chrome and Brave

1. Sign in as `FocusAdmin`. Open **PowerShell** as administrator.
2. Run, with the real ID:

   ```
   cd "C:\Program Files\Focus Lock\resources\admin"
   powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop
   ```

3. Restart Chrome and Brave. Open `chrome://policy` and `brave://policy`. Both should list `ExtensionInstallForcelist` with the ID. In `chrome://extensions`, Focus Lock now shows "Installed by your organization", with no Remove button.
4. If Yahya loaded the extension earlier with **Load unpacked**, remove that copy. The store copy replaces it.
5. In the Focus Lock app, open **Browsers**. Chrome and Brave should show **Connected** within a minute.

The ID is saved, so later Focus Lock updates keep the policy.

## Day to day

- **Updates:** run a newer `FocusLock-Setup-<version>.exe`. It needs the admin password and keeps all the settings.
- **The app says "The Focus Lock service isn't running":** sign in as `FocusAdmin`, open `services.msc`, and start **Focus Lock**. Logs are in `C:\ProgramData\FocusLock\logs`.
- **Uninstall:** **Settings > Apps > Installed apps > Focus Lock > Uninstall**, with the admin password. This removes the service, the browser policies and the settings.

## What this doesn't cover

- Other browsers. Microsoft Edge is still usable. Uninstalling it isn't supported on Windows 11, so blocking it needs AppLocker or WDAC, which aren't set up here.
- Anyone with the admin password can undo everything. That's the point of you holding it.
- Other devices (phone, tablet, a second PC) aren't covered.
