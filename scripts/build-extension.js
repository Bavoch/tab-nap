const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

// 从 package.json 读取版本号，保证 manifest / package / zip 三处版本一致
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

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

// 打包成可上传到 Chrome Web Store 的 zip。
// 关键：必须在 dist/ 内部执行 zip，确保 manifest.json 在压缩包顶层，
// 否则商店会因为找不到 manifest.json 而拒绝上传。
// zip 本身输出到项目根目录，避免它被包含进下次构建的 dist/。
const projectRoot = path.resolve(__dirname, '..');
const zipName = `tab-nap-v${version}.zip`;
const zipPath = path.join(projectRoot, zipName);
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

try {
  execSync(`zip -r -X "${zipPath}" .`, { cwd: dist, stdio: 'inherit' });
  console.log(`\n✅ 构建成功：${zipName}`);
  console.log(`   该 zip 可直接上传到 Chrome Web Store。`);
} catch (e) {
  console.error('\n❌ 打包失败：', e.message);
  console.error('   请确认系统已安装 zip 命令行工具。');
  process.exit(1);
}
