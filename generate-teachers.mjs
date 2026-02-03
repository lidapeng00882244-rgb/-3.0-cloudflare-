/**
 * 从项目根目录的 teachers.json 生成 functions/teachers-data.js
 * 在「案例生成器3.0 cloudflare部署版本」目录下运行：node scripts/generate-teachers.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
// 优先使用本目录下的 teachers.json，否则使用上级目录（案例生成器项目1.0）的 teachers.json
const jsonPath = path.join(root, 'teachers.json');
const jsonPathFallback = path.join(root, '..', 'teachers.json');
const actualPath = fs.existsSync(jsonPath) ? jsonPath : jsonPathFallback;
const outPath = path.join(root, 'functions', 'teachers-data.js');

const data = JSON.parse(fs.readFileSync(actualPath, 'utf8'));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, 'export default ' + JSON.stringify(data) + ';\n', 'utf8');
console.log('Generated', outPath, 'with', data.length, 'teachers');
