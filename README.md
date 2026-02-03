# 案例生成器 3.0 - Cloudflare 全栈部署版

本目录包含可在 **Cloudflare Pages** 上完整运行的前端 + Functions（API）代码，对应「案例生成器项目1.0」的 2.0 前端与 Node 后端逻辑，适配 Cloudflare 部署。

## 目录结构

```
案例生成器3.0 cloudflare部署版本/
├── index.html              # 前端单页（Vue 3 + Tailwind CDN）
├── teachers.json           # 导师数据（需从项目根目录复制，见下）
├── functions/
│   ├── health.js           # GET /health 健康检查
│   ├── teachers-data.js    # 导师数据模块（由脚本生成）
│   └── api/
│       └── [[path]].js     # /api/* 所有接口
├── scripts/
│   └── generate-teachers.mjs  # 从 teachers.json 生成 teachers-data.js
└── README.md
```

## 部署前必做

### 1. 生成导师数据

- 将**案例生成器项目1.0** 根目录下的 `teachers.json` 复制到本目录（与 `index.html` 同级）。
- 在本目录下执行：
  ```bash
  node scripts/generate-teachers.mjs
  ```
  会生成 `functions/teachers-data.js`。未生成时匹配导师将无结果。

### 2. Cloudflare 配置

在 **Cloudflare Dashboard → Workers & Pages → 你的 Pages 项目 → Settings → Functions** 中：

1. **环境变量 / 密钥**
   - `DASHSCOPE_API_KEY`：通义千问 API Key（生成案例、AI 匹配导师必填）。

2. **KV 命名空间**
   - 新建一个 KV 命名空间（如 `CASES_KV`），用于存储案例。
   - 在 Pages 的 **Functions** 设置里，将该 KV 绑定到变量名：`CASES_KV`。
   - 未绑定 KV 时，案例列表/详情/保存/删除会退化为空或仅当次请求有效，建议绑定。

## 部署方式

### 方式一：Git 连接（推荐）

1. 将本目录作为仓库根目录推送到 GitHub（或 GitLab）。
2. 在 Cloudflare Dashboard 中 **Create application → Pages → Connect to Git**，选择该仓库。
3. 构建配置：
   - **Build command**：留空或填 `exit 0`（无构建）。
   - **Build output directory**：填 `.`（根目录即静态资源目录）。
4. 在 **Settings → Functions** 中按上文配置 `DASHSCOPE_API_KEY` 和 KV 绑定 `CASES_KV`。
5. 部署完成后访问 `https://<项目名>.pages.dev`。

### 方式二：直接上传

1. 确保已运行 `node scripts/generate-teachers.mjs` 生成 `functions/teachers-data.js`。
2. 在 Cloudflare Dashboard 中 **Create application → Pages → Create project → Direct Upload**。
3. 将本目录下所有文件（含 `index.html`、`functions/` 等）打成 zip 上传。
4. 上传后在 **Settings → Functions** 中配置环境变量与 KV 绑定。

## API 说明

- `GET /health`：健康检查。
- `POST /api/match-teachers`：匹配导师（body: `{ direction, position? }`）。
- `POST /api/generate-case`：生成案例（需 `DASHSCOPE_API_KEY`）。
- `POST /api/save-case`：保存案例（需 KV 绑定）。
- `GET /api/cases`：案例列表。
- `GET /api/cases/:id`：案例详情。
- `DELETE /api/cases/:id`：删除案例。

前端默认使用同源（`window.location.origin`），部署在 Pages 后与 Functions 同域，无需改 API 地址。

## 与 1.0 / 2.0 的关系

- **前端**：与 2.0 案例生成器一致（Vue 3 + Tailwind，单页）。
- **后端**：由 Node + Express 改为 Cloudflare Pages Functions，导师数据内联在 `teachers-data.js`，案例存储使用 KV。
- **数据**：需从 1.0 项目复制 `teachers.json` 并运行脚本生成 `teachers-data.js`。

上传到 GitHub 时，建议将本目录作为独立仓库或 monorepo 下的子目录；若单独仓库，根目录即本目录内容即可。
