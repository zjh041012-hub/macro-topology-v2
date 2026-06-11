# MACRO TOPOLOGY — 前端 (Vite + React)

消费数据仓库 `output/*.json` 的真实数据; 加载失败自动回退内置演示数据(顶栏显示 DEMO DATA / LIVE)。

## 快速开始
```bash
npm install
npm run dev        # http://localhost:5173
```

## 数据源配置
`.env` 已预置:
```
VITE_DATA_BASE=https://raw.githubusercontent.com/zjh041012-hub/macro-topology-v2/main/output
```
改仓库/分支只改这一行; 改完重启 dev server (Vite 仅启动时读 .env)。

## 结构
```
src/
  App.jsx                    # 数据加载层 (loading态 / 回退)
  MacroTopologyTerminal.jsx  # 3D拓扑终端 (接收 live prop)
  data/loaders.js            # fetch 5个JSON + 形状适配 (title→label, history→{d,value})
```

## 部署
`npm run build` 产出 dist/, 任意静态托管 (GitHub Pages / Vercel / Cloudflare Pages)。
raw.githubusercontent.com 带 CORS 头, 前端可直接跨域读取。
