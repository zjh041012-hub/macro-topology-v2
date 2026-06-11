// src/App.jsx —— 数据加载层: 真实数据优先, 失败回退内置演示数据
import React, { useEffect, useState } from "react";
import MacroTopologyTerminal from "./MacroTopologyTerminal.jsx";
import { loadAllWithFallback } from "./data/loaders.js";

export default function App() {
  const [state, setState] = useState({ loading: true, data: null });

  useEffect(() => {
    let alive = true;
    loadAllWithFallback().then((data) => {
      if (alive) setState({ loading: false, data });
    });
    return () => { alive = false; };
  }, []);

  if (state.loading) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#05070c", color: "#8fa3b8",
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace", fontSize: 13, letterSpacing: 2,
      }}>
        MACRO TOPOLOGY · LOADING LIVE DATA…
      </div>
    );
  }

  return <MacroTopologyTerminal live={state.data} />;
}
