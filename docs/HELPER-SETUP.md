# Focus Lock setup guide for the helper

This is for the person who sets up Focus Lock on Yahya's laptop and keeps the admin password. It takes about 30 minutes, plus a few days of waiting for the Chrome Web Store review in step 4.

When it's done:

- Yahya uses a **standard** Windows account. Only the admin account can uninstall Focus Lock, stop its service, or change or delete its files.
- The Focus Lock app is installed in `C:\Program Files\Focus Lock`, and its settings are in `C:\ProgramData\FocusLock`. Standard users can read them but can't change or delete them.
- Chrome and Brave install the extension themselves through browser policy, and it can't be removed or turned off. Incognito and guest windows are turned off, and so are Brave's Tor windows.
- Other browsers (Firefox, Opera, Vivaldi, Tor and more) won't open. Other programs aren't affected.

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

## 6. Block other browsers

This step blocks the browsers people use to get around a blocker, using App Control for Business, which is built into Windows 11 Pro. Chrome and Brave keep working, and Edge is left alone for now. **Everything else keeps working**: this is a blocklist of browsers, not an allowlist, so work programs install and run as normal.

Blocked browsers:

1. Firefox
2. Opera
3. Opera GX
4. Vivaldi
5. Tor Browser
6. DuckDuckGo
7. Waterfox
8. LibreWolf
9. Floorp
10. Yandex Browser

Arc, Zen, Pale Moon and Mullvad Browser are blocked too.

Windows checks the name each program has stored inside it, not the file name. So renaming the .exe, using a portable copy from Downloads or a USB stick, or installing from the Microsoft Store doesn't get around the block. You don't need to block the Store itself.

Start in **audit mode** first. In audit mode nothing is blocked, and Windows only writes down what it would block.

1. As `FocusAdmin`, open PowerShell as administrator and run:

   ```
   cd "C:\Program Files\Focus Lock\resources\admin\browser-block"
   powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1
   ```

2. Use the laptop normally for a day: open the work programs, and try opening Firefox or another browser from the list.
3. Open **Event Viewer > Applications and Services Logs > Microsoft > Windows > CodeIntegrity > Operational**. Event **3076** means "would have blocked". It should only list the browsers. If a work program shows up, don't go on to step 4. Tell Yahya, so the rule that caught it can be removed from `FocusLock-BrowserDeny.xml`.
4. Turn on blocking:

   ```
   powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1 -Enforce
   ```

   Opening a listed browser now shows "Your organization used App Control for Business to block this app". No restart is needed.

To turn it off, run `Disable-BrowserBlock.ps1` as administrator. Uninstalling Focus Lock also turns it off. To add a browser, follow the note at the top of `FocusLock-BrowserDeny.xml`, then run step 4 again.

This needs Windows 11 version 22H2 or later. To check, open **Settings > System > About**.

## Day to day

- **Updates:** run a newer `FocusLock-Setup-<version>.exe`. It needs the admin password and keeps all the settings.
- **The app says "The Focus Lock service isn't running":** sign in as `FocusAdmin`, open `services.msc`, and start **Focus Lock**. Logs are in `C:\ProgramData\FocusLock\logs`.
- **Uninstall:** **Settings > Apps > Installed apps > Focus Lock > Uninstall**, with the admin password. This removes the service, the browser policies and the settings.

## What this doesn't cover

- Microsoft Edge is still usable. It can be added to the browser block later, but Windows uses parts of Edge internally, so test it in audit mode first.
- A browser that isn't on the list, or a little-known Chrome copy that still calls itself `chrome.exe`, isn't blocked.
- Anyone with the admin password can undo everything. That's the point of you holding it.
- Other devices (phone, tablet, a second PC) aren't covered.
