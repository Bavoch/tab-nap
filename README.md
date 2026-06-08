# TabNap 😴

**Automatically clean and organize messy tabs with Chrome native Tab Groups.**

TabNap is a powerful yet lightweight Chrome extension designed to declutter your browsing experience. It intelligently puts inactive tabs to "sleep" to save memory and organizes them using native Chrome Tab Groups, keeping your browser fast and your mind focused.

---

## Key Features ✨

- **🚀 Auto-Nap (Discarding):** Automatically put idle tabs to sleep after a customizable period to free up system memory.
- **📁 Smart Grouping:** Automatically moves sleeping tabs into a dedicated, collapsed "Nap" group to keep your tab bar tidy.
- **⏰ Live Countdowns:** See exactly how much time is left before a tab naps or closes directly in the popup.
- **🛡️ Intelligent Protection:**
  - **Audio Protection:** Never sleep tabs that are currently playing music or video.
  - **Pinned Tabs:** Your pinned tabs are always safe and never touched.
  - **Active Tabs Protection:** Keep a specific number of your most recently used tabs active.
- **📝 Flexible Whitelist:** Easily exclude specific domains or keywords from being napped or closed.
- **♻️ Auto-Close:** Optionally close tabs that have been inactive for an extended period.
- **🎨 Native Integration:** Built on top of Chrome's native Tab Groups for a seamless and stable experience.

---

## How it Works 🛠️

TabNap uses the official Chrome `discard` API, which suspends tabs without removing them from your tab bar. This means you get the memory savings of closing a tab, but it stays right where it is, ready to be "woken up" with a single click.

Combined with **Chrome Tab Groups**, TabNap transforms a messy row of 50+ tabs into a clean, organized workspace.

---

## Installation 📦

### Development

1. Run `npm install`.
2. Start the dev server with `npm run dev`.
3. Open Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer Mode**.
5. Click **Load unpacked** and select the `dist/` folder.
6. Keep the dev server running. Changes will hot reload without manual extension reloads.

### Release build

1. Run `npm run build`.
2. Load the generated `dist/` folder in Chrome.

---

## Privacy First 🔒

- **No Data Collection:** TabNap does not track your browsing history or collect any personal data.
- **Local Processing:** All settings and tab management happen locally on your device.
- **Open Source:** Transparent code that respects your privacy.
- [Read our full Privacy Policy here](https://bavoch.github.io/tab-nap/privacy.html).

---

## Screenshots 📸

<p align="center">
  <img src="public/TabNap-Chrome 1.png" width="800" alt="TabNap Before & After">
  <br>
  <img src="public/TabNap-Chrome 2.png" width="800" alt="TabNap Features & Settings">
</p>

---

## Project Structure 📂

- `background.js`: Core logic for timers, grouping, and tab management.
- `popup.html/js`: Fast access to tab status and manual controls.
- `manifest.json`: Extension configuration (Manifest V3).
- `_locales/`: Internationalization support (English, Chinese).
- `vite.config.js`: CRXJS dev server and HMR configuration.

---

## Contributing 🤝

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Bavoch/tab-nap/issues).

---

## License 📄

This project is [MIT](LICENSE) licensed.

---

<p align="center">Made with ❤️ for a faster, cleaner browsing experience.</p>
