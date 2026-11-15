# Focus Lock setup guide for the helper

This guide is for the person who sets up Focus Lock on Yahya's laptop and keeps the admin password. Setup takes about 20 minutes, plus a day of testing the browser block in step 4.

When it's done:

- Yahya uses a **standard** Windows account. Only the admin account can uninstall Focus Lock, stop its service, or change or delete its files.
- The Focus Lock app is installed in `C:\Program Files\Focus Lock`, and its settings are in `C:\ProgramData\FocusLock`. Standard users can read those files but can't change or delete them.
- Chrome, Brave and Edge block sites themselves, using browser policy that the Focus Lock service writes. There's no extension to install or remove. The service switches the block list when Yahya's blocking hours start and end.
- In every one of those browsers, SafeSearch and YouTube Restricted Mode are always on. Incognito, InPrivate and guest windows are off, and so are secure DNS and Brave's Tor windows.
- Other browsers (Firefox, Opera, Vivaldi, Tor and more) won't open. Other programs aren't affected.

Yahya still changes his own hours, lists and strict mode in the app. The service applies the rules: looser changes wait 24 hours, and none are allowed during strict mode.

## 1. Make the admin account (helper)

Sign in to Yahya's laptop with the account that is currently an administrator.

1. Open **Settings > Accounts > Other users > Add account**.
2. Choose **I don't have this person's sign-in information**, then **Add a user without a Microsoft account**.
3. Name it, for example `FocusAdmin`. Pick a strong password and keep it to yourself.
4. Back in **Other users**, select the new account, choose **Change account type**, and pick **Administrator**.

## 2. Make Yahya's account standard

1. Sign out, then sign in as `FocusAdmin`.
2. Open **Settings > Accounts > Other users**. Select Yahya's account, choose **Change account type**, and pick **Standard User**.

From now on, when something needs admin rights, Windows asks for the `FocusAdmin` password. Only you type it.

## 3. Install Focus Lock

1. Download the installer: [FocusLock-Setup.exe](https://github.com/johnahmanbmc-prog/focus-lock/releases/latest/download/FocusLock-Setup.exe). It's also on the repo's **Releases** page. Sign in to GitHub first, because the repo is private.
2. Run `FocusLock-Setup.exe`. When Windows asks, enter the `FocusAdmin` password.
3. The installer:
   - puts the app in `C:\Program Files\Focus Lock`
   - creates `C:\ProgramData\FocusLock`, where only admins can change files
   - installs and starts the **Focus Lock** Windows service, which starts with Windows and restarts if it stops
4. Check that it worked:
   - Open **Services** (`services.msc`). **Focus Lock** should show **Running** and **Automatic**.
   - Restart Chrome, Brave and Edge, then open `chrome://policy`, `brave://policy` and `edge://policy`. Each should list `URLBlocklist`, `ForceGoogleSafeSearch` and the others, with status OK.
   - Try opening `pornhub.com` in each browser. It should show "This site is blocked by your organization".

## 4. Block other browsers

This step uses App Control for Business, which is built into Windows 11 Pro, to block the browsers people use to get around a block list. Chrome, Brave and Edge keep working, because Focus Lock controls them through policy. **Everything else keeps working too.** This is a blocklist of browsers, not an allowlist, so work programs install and run as normal.

The blocked browsers are:

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

Windows checks the name stored inside each program, not its file name. So renaming the .exe, running a portable copy from Downloads or a USB stick, or installing one from the Microsoft Store doesn't get around it. You don't need to block the Store itself.

Start in **audit mode**. In audit mode nothing is blocked; Windows only records what it would block.

1. As `FocusAdmin`, open PowerShell as administrator and run:

   ```
   cd "C:\Program Files\Focus Lock\resources\admin\browser-block"
   powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1
   ```

2. Use the laptop normally for a day. Open the work programs, and try opening Firefox or another browser from the list.
3. Open **Event Viewer > Applications and Services Logs > Microsoft > Windows > CodeIntegrity > Operational**. Event **3076** means "would have blocked". It should list only the browsers. If a work program shows up, don't go on to step 4. Tell Yahya, so the rule that caught it can be removed from `FocusLock-BrowserDeny.xml`.
4. Turn on blocking:

   ```
   powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1 -Enforce
   ```

   Opening a listed browser now shows "Your organization used App Control for Business to block this app". No restart is needed.

To turn it off, run `Disable-BrowserBlock.ps1` as administrator. Uninstalling Focus Lock also turns it off. To add a browser, follow the note at the top of `FocusLock-BrowserDeny.xml`, then run step 4 again.

This needs Windows 11 version 22H2 or later. To check, open **Settings > System > About**.

## Day to day

- **Updates:** download the latest `FocusLock-Setup.exe` again and run it. It needs the admin password and keeps all the settings.
- **The app says "The Focus Lock service isn't running":** sign in as `FocusAdmin`, open `services.msc`, and start **Focus Lock**. The browsers keep the last block list until then. Logs are in `C:\ProgramData\FocusLock\logs`.
- **Uninstall:** go to **Settings > Apps > Installed apps > Focus Lock > Uninstall**, with the admin password. This removes the service, the browser block, the settings and every browser policy Focus Lock set. Policies set by anything else stay.

## What this doesn't cover

- **Keywords.** Browser policy blocks whole sites and paths, not words. A new pirate site with a new name isn't blocked until it's added to the list. Searches are still filtered by SafeSearch, and YouTube by Restricted Mode, whenever those sites are open.
- **Web proxy sites** that load other sites inside their own pages. Add any you find to Yahya's own sites in the app.
- Anyone with the admin password can undo everything. That's the point of you holding it.
- Other devices, such as a phone, tablet or second PC.
