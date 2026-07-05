const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const files = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'i18n.js',
  'popup.html',
  'popup.js',
  'privacy.html',
];
const dirs = ['icons', '_locales', 'public'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

for (const dir of dirs) {
  fs.cpSync(path.join(root, dir), path.join(dist, dir), {
    recursive: true,
    filter: source => path.basename(source) !== '.DS_Store',
  });
}
