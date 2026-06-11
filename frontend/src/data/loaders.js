// src/data/loaders.js —— 拉取管道产出的真实 JSON, 并适配为组件所需形状
//
// 数据源由 .env 的 VITE_DATA_BASE 决定, 默认指向 GitHub 仓库 output 目录。
// 任一文件加载失败 → 整体回退到组件内置的演示数据 (live: false)。

const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "/data";

async function getJSON(name) {
  const res = await fetch(`${DATA_BASE}/${name}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`load ${name} failed: ${res.status}`);
  return res.json();
}

/* ---------- 形状适配: 管道字段 → 前端字段 ---------- */

// 管道 history: [{date:"MM-DD", value}] (升序) → 图表需要 [{d, value}], d 为距今天数
function adaptHistory(h) {
  if (!Array.isArray(h) || h.length < 5) return null; // 过短序列回退合成曲线
  return h.map((p, i) => ({ d: h.length - 1 - i, value: p.value }));
}

function adaptNodes(nodes) {
  return nodes.map((n) => ({ ...n, history: adaptHistory(n.history) }));
}

// 管道 paths 用 title, 前端用 label
function adaptPaths(paths) {
  return paths.map((p) => ({ ...p, label: p.label ?? p.title ?? "" }));
}

export async function loadAll() {
  const [nodes, edges, paths, divergences, marketState] = await Promise.all([
    getJSON("nodes.json"),
    getJSON("edges.json"),
    getJSON("paths.json"),
    getJSON("divergences.json"),
    getJSON("market_state.json"),
  ]);
  return {
    nodes: adaptNodes(nodes),
    edges,
    paths: adaptPaths(paths),
    divergences,
    marketState,
    live: true,
  };
}

export async function loadAllWithFallback() {
  try {
    return await loadAll();
  } catch (e) {
    console.warn("[loaders] live data unavailable, fallback to built-in mock:", e);
    return null; // 组件收到 null 时使用内置演示数据
  }
}
