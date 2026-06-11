import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as THREE from "three";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

/* ============================================================
   MACRO TOPOLOGY — 宏观市场思维拓扑监控终端 (单文件可运行预览)
   3D 球形知识图谱 · 传导路径 · 变量背离 · 逻辑失效监控
   技术: React + 原生 Three.js (r128) + Recharts + Tailwind 布局
   ============================================================ */

/* ----------------------- 主题 / 常量 ----------------------- */
const BG = "#05070c";
const PANEL = "rgba(10,14,22,0.86)";
const PANEL_BORDER = "rgba(120,140,170,0.16)";
const TXT = "#c7d1de";
const TXT_DIM = "#6b7787";
const MONO = "'SF Mono','JetBrains Mono',Menlo,Consolas,monospace";

const CATS = {
  rates:     { label: "利率",     color: "#5b8fe0" },
  inflation: { label: "通胀",     color: "#e0954e" },
  growth:    { label: "增长",     color: "#56b87c" },
  liquidity: { label: "流动性",   color: "#9a7fe8" },
  fx:        { label: "汇率",     color: "#46c8c8" },
  credit:    { label: "信用",     color: "#c06ad6" },
  asset:     { label: "资产",     color: "#e6d8a8" },
  risk:      { label: "风险事件", color: "#e06060" },
};
const STATUS = {
  NORMAL:      { label: "NORMAL",      color: "#8fa3b8" },
  ELEVATED:    { label: "ELEVATED",    color: "#e8c558" },
  EXTREME:     { label: "EXTREME",     color: "#ff7a45" },
  DIVERGENCE:  { label: "DIVERGENCE",  color: "#e055c8" },
  INVALIDATED: { label: "INVALIDATED", color: "#ff5252" },
};
const EDGE_STYLE = {
  INACTIVE:    { color: "#9fb0c4", opacity: 0.10 },
  ACTIVE:      { color: "#ffd9a0", opacity: 0.55 },
  DIVERGENCE:  { color: "#e055c8", opacity: 0.78 },
  INVALIDATED: { color: "#ff5252", opacity: 0.72 },
};
const WINDOWS = ["1D", "5D", "20D", "60D"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

/* ----------------------- 模拟数据:节点 ----------------------- */
// N(id, name, cat, pri, value, unit, c1d, c5d, c20d, c60d, percentile, status, desc, invalidation?)
const N = (id, name, category, priority, value, unit, c1, c5, c20, c60, percentile, status, description, invalidation) =>
  ({ id, name, category, priority, value, unit, change1d: c1, change5d: c5, change20d: c20, change60d: c60, percentile, status, description, invalidation });

/* 数据质量标识: 管道输出 quality 字段 → 徽章 (模拟数据无此字段则不显示) */
const QUALITY_BADGE = {
  derived: { label: "派生", color: "#9a7fe8", title: "由其他真实序列派生/代理计算" },
  manual:  { label: "手工", color: "#8fa3b8", title: "暂无免费数据源, 注册表手工维护" },
  stale:   { label: "未取到", color: "#ff7a45", title: "本次抓取失败, 显示占位值" },
};
const QualityTag = ({ n, big }) => {
  const q = QUALITY_BADGE[n?.quality];
  if (!q) return null;
  return (
    <span title={q.title} className={big ? "px-2 py-0.5 rounded text-xs" : "px-1.5 py-0.5 rounded text-xs"}
      style={{ fontFamily: "'JetBrains Mono','SF Mono',Consolas,monospace", fontSize: 10, color: q.color, border: `1px solid ${q.color}55`, background: `${q.color}18` }}>
      {q.label}
    </span>
  );
};

const REGIME_IDS = new Set(["geopolitics", "debtceiling", "fiscalworry", "usepu", "cnepu",
  "cnpropregime", "usbankrisk", "liqcrisis", "reflation", "recession", "stagflation", "riskoff"]);

const RAW_NODES = [
  // —— 利率与货币政策 ——
  N("us10y", "美国10年期国债收益率", "rates", "P0", 4.62, "%", 0.06, 0.31, 0.48, 0.55, 96, "EXTREME",
    "长端收益率快速上行,主要由期限溢价与财政供给驱动,而非政策预期。",
    "若收益率回落至4.20%下方且美元同步走强,则财政供给主导逻辑失效,回归联储路径框架。"),
  N("us2y", "美国2年期国债收益率", "rates", "P1", 4.21, "%", 0.02, 0.09, 0.12, 0.10, 78, "ELEVATED",
    "短端温和上行,联储政策预期变化有限,与长端涨幅明显脱节。"),
  N("us10yreal", "美国10年期实际利率", "rates", "P0", 2.18, "%", 0.05, 0.18, 0.34, 0.42, 92, "EXTREME",
    "实际利率快速上升,可能对黄金和长久期成长资产形成压力。",
    "若黄金在实际利率维持高位的情况下持续上涨超过20日,实际利率-黄金负相关框架视为阶段性失效。"),
  N("us10ybe", "美国10年期盈亏平衡通胀", "rates", "P1", 2.44, "%", 0.01, 0.04, 0.06, 0.05, 64, "NORMAL",
    "盈亏平衡通胀基本持稳,本轮名义利率上行未被通胀预期确认。"),
  N("fedfunds", "美联储政策利率", "rates", "P1", 5.375, "%", 0.0, 0.0, 0.0, -0.25, 55, "NORMAL",
    "政策利率维持不变,处于观望期。"),
  N("fedpath", "美联储政策利率预期(1Y远期)", "rates", "P0", 4.86, "%", 0.03, 0.08, -0.05, -0.12, 60, "ELEVATED",
    "市场定价的政策路径仅小幅上修,难以解释长端利率的上行斜率。"),
  N("termprem", "美债10Y期限溢价", "rates", "P0", 0.82, "%", 0.04, 0.22, 0.38, 0.51, 97, "EXTREME",
    "期限溢价显著走阔,是本轮长端收益率上行的核心来源。",
    "若期限溢价在供给落地后快速回落>20bp,本轮利率冲击视为阶段性结束。"),
  N("us30y", "美国30年期国债收益率", "rates", "P2", 4.85, "%", 0.07, 0.34, 0.52, 0.58, 95, "ELEVATED",
    "超长端领涨,曲线远端对供给与财政担忧最敏感。"),
  N("t2s10s", "美债2s10s利差", "rates", "P2", 0.41, "%", 0.04, 0.22, 0.36, 0.45, 88, "ELEVATED",
    "曲线熊陡,与供给/期限溢价驱动的利率上行特征一致。"),
  N("cn10y", "中国10年期国债收益率", "rates", "P1", 1.72, "%", 0.0, -0.02, -0.05, -0.08, 8, "ELEVATED",
    "中债收益率低位徘徊,与美债走势持续分化,体现独立的国内货币周期。"),
  N("r007", "R007", "rates", "P2", 1.85, "%", 0.01, 0.03, -0.02, -0.05, 34, "NORMAL",
    "银行间回购利率平稳,资金面均衡偏松。"),
  N("dr007", "DR007", "rates", "P2", 1.78, "%", 0.0, 0.02, -0.03, -0.06, 30, "NORMAL",
    "存款类机构资金利率围绕政策利率窄幅波动。"),
  N("mlf", "MLF利率", "rates", "P3", 2.0, "%", 0.0, 0.0, 0.0, -0.1, 20, "NORMAL", "中期政策利率维持不变。"),
  N("lpr", "1年期LPR", "rates", "P3", 3.1, "%", 0.0, 0.0, 0.0, -0.1, 18, "NORMAL", "贷款市场报价利率持平。"),
  N("sofr", "SOFR", "rates", "P3", 5.31, "%", 0.0, 0.0, -0.01, -0.02, 52, "NORMAL", "美元隔夜融资利率平稳,无回购市场压力迹象。"),
  N("jgb10y", "日本10年期国债收益率", "rates", "P3", 1.05, "%", 0.01, 0.06, 0.12, 0.2, 90, "ELEVATED",
    "日债收益率上行,边际推升全球久期供给压力。"),
  N("bund10y", "德国10年期国债收益率", "rates", "P3", 2.58, "%", 0.02, 0.08, 0.1, 0.15, 72, "NORMAL", "欧债跟随美债温和上行。"),

  // —— 汇率 ——
  N("dxy", "美元指数", "fx", "P0", 101.8, "idx", -0.4, -1.6, -2.3, -1.1, 18, "DIVERGENCE",
    "美债收益率大幅上行的同时美元走弱,与传统利差逻辑显著背离。",
    "若美元随利率回升而修复,背离解除;若持续走弱,则指向财政信用溢价与资金流出主导。"),
  N("usdcny", "美元兑人民币", "fx", "P1", 7.18, "", -0.1, -0.5, -0.8, -1.2, 42, "NORMAL",
    "人民币随美元走弱小幅升值,波动可控。"),
  N("eurusd", "欧元兑美元", "fx", "P2", 1.112, "", 0.4, 1.5, 2.1, 1.4, 70, "ELEVATED", "欧元被动走强,反映美元端压力。"),
  N("usdjpy", "美元兑日元", "fx", "P1", 153.2, "", -0.3, -1.2, -1.8, -0.6, 62, "NORMAL",
    "日元小幅修复,日债收益率上行提供支撑。"),
  N("usdcnh", "美元兑离岸人民币", "fx", "P3", 7.2, "", -0.1, -0.5, -0.9, -1.3, 44, "NORMAL", "离岸价差稳定,无明显贬值预期。"),
  N("gbpusd", "英镑兑美元", "fx", "P3", 1.298, "", 0.2, 1.1, 1.6, 0.9, 66, "NORMAL", "英镑随美元走弱被动升值。"),
  N("audusd", "澳元兑美元", "fx", "P3", 0.672, "", 0.3, 1.4, 2.2, 1.8, 58, "NORMAL", "商品货币受铜价与中国需求改善支撑。"),

  // —— 通胀 ——
  N("uscpi", "美国CPI(同比)", "inflation", "P0", 3.4, "%YoY", 0.0, 0.1, 0.3, 0.4, 71, "ELEVATED",
    "通胀回落进程停滞,服务粘性仍高,但尚不足以解释长端利率斜率。"),
  N("uscorecpi", "美国核心CPI(同比)", "inflation", "P1", 3.6, "%YoY", 0.0, 0.1, 0.2, 0.2, 74, "ELEVATED",
    "核心通胀缓慢回落,住房分项贡献仍大。"),
  N("uspce", "美国核心PCE(同比)", "inflation", "P2", 2.8, "%YoY", 0.0, 0.0, 0.1, 0.1, 62, "NORMAL", "联储目标口径通胀温和。"),
  N("cncpi", "中国CPI(同比)", "inflation", "P2", 0.6, "%YoY", 0.0, 0.1, 0.2, 0.3, 12, "NORMAL", "国内通胀低位,需求端弹性有限。"),
  N("cnppi", "中国PPI(同比)", "inflation", "P2", -1.8, "%YoY", 0.1, 0.3, 0.5, 0.8, 9, "NORMAL",
    "PPI仍处通缩区间,但跌幅随工业品需求改善收窄。"),
  N("infl5y5y", "美国5y5y通胀互换", "inflation", "P2", 2.38, "%", 0.0, 0.02, 0.03, 0.02, 55, "NORMAL", "长期通胀预期锚定良好。"),
  N("crb", "CRB商品指数", "inflation", "P2", 287, "idx", 0.5, 1.8, 3.2, 4.5, 60, "NORMAL", "商品综合指数温和走强。"),

  // —— 增长 ——
  N("uspmi", "美国制造业PMI", "growth", "P1", 49.2, "idx", 0.0, 0.4, -0.6, -1.1, 38, "NORMAL", "美国制造业仍在荣枯线下方徘徊。"),
  N("cnpmi", "中国制造业PMI", "growth", "P1", 49.6, "idx", 0.0, 0.3, 0.5, 0.4, 35, "NORMAL", "总量PMI仍弱,但结构出现改善。"),
  N("cnpminew", "中国PMI新订单", "growth", "P1", 51.2, "idx", 0.0, 0.8, 1.5, 1.9, 72, "ELEVATED",
    "新订单重回扩张区间,领先指向工业品需求边际改善。"),
  N("indprod", "中国工业增加值(同比)", "growth", "P2", 5.6, "%YoY", 0.0, 0.2, 0.4, 0.5, 58, "NORMAL", "工业生产平稳偏强。"),
  N("retail", "社会消费品零售总额(同比)", "growth", "P2", 4.2, "%YoY", 0.0, 0.1, 0.3, 0.2, 41, "NORMAL", "消费温和修复,弹性仍受收入预期约束。"),
  N("fai", "固定资产投资(累计同比)", "growth", "P2", 3.5, "%YoY", 0.0, 0.1, 0.2, 0.1, 33, "NORMAL", "投资增速平稳,基建托底。"),
  N("nfp", "美国非农新增就业", "growth", "P2", 175, "k", 0.0, -8, -22, -35, 46, "NORMAL", "就业温和降温,未触发衰退信号。"),
  N("unemp", "美国失业率", "growth", "P3", 4.1, "%", 0.0, 0.0, 0.1, 0.2, 60, "NORMAL", "失业率小幅抬升但仍处低位。"),
  N("exports", "中国出口(同比)", "growth", "P3", 6.8, "%YoY", 0.0, 0.5, 1.2, 2.0, 67, "NORMAL", "出口韧性超预期,支撑制造业订单。"),
  N("inddemand", "工业品需求(合成指标)", "growth", "P2", 54.3, "idx", 0.2, 1.1, 2.4, 3.0, 70, "ELEVATED",
    "由新订单、出口与开工率合成,边际改善趋势确立。"),
  N("usclaims", "美国初请失业金人数", "growth", "P3", 218, "k", 1, 4, 6, -3, 48, "NORMAL", "初请数据平稳,劳动力市场未见裂痕。"),

  // —— 流动性 ——
  N("m1", "中国M1(同比)", "liquidity", "P2", 2.1, "%YoY", 0.0, 0.2, 0.6, 1.1, 24, "NORMAL", "M1低位回升,企业活化资金边际改善。"),
  N("m2", "中国M2(同比)", "liquidity", "P2", 7.0, "%YoY", 0.0, 0.1, 0.2, 0.1, 31, "NORMAL", "广义货币增速平稳。"),
  N("tsf", "社会融资规模存量(同比)", "liquidity", "P1", 8.2, "%YoY", 0.0, 0.1, 0.3, 0.4, 40, "NORMAL", "社融增速企稳,政府债券为主要支撑。"),
  N("usfci", "美国金融条件指数", "liquidity", "P1", -0.32, "idx", 0.02, 0.08, 0.12, 0.1, 63, "ELEVATED",
    "金融条件随利率上行边际收紧,但绝对水平仍偏宽松。"),
  N("fedbs", "美联储资产负债表", "liquidity", "P2", 6.9, "$tn", 0.0, -0.1, -0.3, -0.8, 35, "NORMAL", "缩表按既定节奏推进。"),
  N("rrp", "美联储隔夜逆回购(RRP)", "liquidity", "P3", 0.42, "$tn", -0.01, -0.04, -0.1, -0.3, 15, "NORMAL", "RRP余额持续下行,缓冲垫变薄。"),
  N("pboc", "央行OMO净投放(7D滚动)", "liquidity", "P2", 1800, "亿元", 200, 600, -300, 400, 57, "NORMAL", "公开市场操作维持中性偏松。"),
  N("riskappetite", "全球风险偏好指数", "liquidity", "P1", 47, "idx", -1.0, -4.0, -6.0, -3.0, 36, "ELEVATED",
    "风险偏好走弱,但弱化程度与股票回撤不完全匹配。"),
  N("northbound", "北向资金(5D净流入)", "liquidity", "P3", 56, "亿元", 12, 56, 88, 120, 61, "NORMAL", "外资温和回流A股。"),

  // —— 信用 ——
  N("hyspread", "美国高收益债信用利差", "credit", "P0", 3.05, "%", 0.01, 0.03, -0.05, -0.12, 22, "DIVERGENCE",
    "股票回调的同时高收益利差几乎未动,信用市场没有确认衰退或系统性风险担忧。",
    "若利差5日内快速走阔超过50bp,背离解除,情景转向风险收缩。"),
  N("igspread", "美国投资级信用利差", "credit", "P1", 1.12, "%", 0.0, 0.01, -0.02, -0.05, 18, "NORMAL", "投资级利差处于历史低位区间。"),
  N("vix", "VIX指数", "credit", "P1", 19.8, "idx", 1.2, 3.4, 4.6, 2.8, 68, "ELEVATED",
    "股票波动率抬升,但远未到恐慌区间。"),
  N("move", "MOVE利率波动率指数", "credit", "P2", 118, "idx", 4, 16, 24, 20, 84, "ELEVATED",
    "利率波动率显著上行,与期限溢价走阔互为印证。"),

  // —— 资产 ——
  N("gold", "黄金", "asset", "P0", 2742, "$/oz", 0.8, 3.6, 6.2, 9.8, 98, "DIVERGENCE",
    "实际利率上行背景下黄金续创新高,央行购金与法币信用对冲需求主导。",
    "若金价随实际利率回落而下跌,传统机会成本框架恢复;若继续同涨,确认财政/信用对冲叙事。"),
  N("oil", "原油(WTI)", "asset", "P1", 84.6, "$/bbl", 0.6, 2.1, 4.0, 6.5, 58, "ELEVATED",
    "油价温和上行,供给端扰动为主,需求定价有限。"),
  N("copper", "铜(LME)", "asset", "P1", 9420, "$/t", 0.5, 2.8, 5.1, 7.2, 76, "ELEVATED",
    "铜价随中国新订单与工业品需求改善走强。"),
  N("csi300", "沪深300", "asset", "P1", 4080, "idx", 0.3, 1.1, 2.4, 4.0, 52, "NORMAL", "A股核心指数温和修复,与美股回调脱敏。"),
  N("ndx", "纳斯达克100", "asset", "P0", 19420, "idx", -1.4, -4.6, -6.8, -3.2, 73, "EXTREME",
    "实际利率冲击下长久期成长股估值显著承压,领跌美股。",
    "若实际利率回落而纳指继续下跌,则压力来源转向盈利端,利率框架失效。"),
  N("spx", "标普500", "asset", "P1", 5840, "idx", -0.8, -2.4, -3.1, -0.5, 64, "ELEVATED",
    "指数回调主要由估值压缩贡献,盈利预期尚稳。"),
  N("cnbond", "中国10年期国债期货", "asset", "P2", 108.4, "idx", 0.0, 0.1, 0.3, 0.5, 86, "NORMAL", "中债期货高位运行,与美债走势分化。"),
  N("convert", "中证可转债指数", "asset", "P2", 412, "idx", 0.1, 0.6, 1.4, 2.6, 55, "NORMAL", "转债跟随权益温和修复,估值中性。"),
  N("comidx", "南华商品指数", "asset", "P2", 226, "idx", 0.4, 2.2, 4.1, 5.8, 66, "ELEVATED", "商品指数受铜与原油带动走强。"),
  N("chipetf", "芯片ETF", "asset", "P2", 1.42, "idx", -1.8, -5.2, -7.5, -2.1, 70, "ELEVATED",
    "高久期成长属性放大实际利率冲击。"),
  N("bankidx", "银行指数", "asset", "P1", 3520, "idx", 0.9, 2.6, 4.4, 6.1, 81, "ELEVATED",
    "利率上行与曲线陡峭化改善息差预期,银行相对收益显著。"),
  N("valueidx", "价值风格指数", "asset", "P2", 8240, "idx", 0.5, 1.8, 3.2, 4.6, 74, "ELEVATED", "价值风格相对占优。"),
  N("growthidx", "成长风格指数", "asset", "P2", 12480, "idx", -1.2, -4.1, -6.2, -2.8, 69, "ELEVATED",
    "成长风格大幅跑输,风格分化达到近一年极值。"),
  N("hsi", "恒生指数", "asset", "P3", 19850, "idx", 0.2, 0.8, 1.9, 3.5, 49, "NORMAL", "港股跟随A股温和修复。"),
  N("em", "新兴市场股指(MSCI EM)", "asset", "P3", 1124, "idx", 0.3, 1.2, 2.0, 2.8, 57, "NORMAL", "美元走弱为新兴市场提供喘息。"),
  N("goldminers", "黄金矿业股", "asset", "P3", 41.2, "idx", 1.2, 5.4, 9.0, 14.2, 95, "ELEVATED", "矿业股弹性放大金价上行。"),

  // —— 风险事件 ——
  N("fiscalsupply", "美债财政供给压力", "risk", "P0", 1.05, "$tn/Q", 0, 12, 18, 25, 95, "EXTREME",
    "季度再融资规模超预期,长端国债净供给压力成为利率核心驱动。",
    "若财政部下调长端发行占比或买回操作放量,供给冲击逻辑减弱。"),
  N("fiscalworry", "财政信用担忧指数", "risk", "P1", 68, "idx", 3, 14, 21, 26, 91, "ELEVATED",
    "对美国财政可持续性的担忧升温,正在弱化『利率↑→美元↑』的传统联动。"),
  N("geopolitics", "地缘政治风险指数", "risk", "P2", 42, "idx", 1, 3, -2, 5, 54, "NORMAL", "地缘风险处于中性区间。"),
  N("debtceiling", "债务上限博弈风险", "risk", "P3", 22, "idx", 0, 1, 2, 4, 38, "NORMAL", "短期无到期窗口,风险温和。"),

  /* ====== 扩展: 美国利率/政策/国债供给 (模拟数据) ====== */
  N("us3m", "美国3个月国库券收益率", "rates", "P2", 5.32, "%", 0.00, 0.01, 0.02, -0.03, 74, "NORMAL", "政策利率锚定下的短端基准。"),
  N("us5y", "美国5年期国债收益率", "rates", "P2", 4.38, "%", 0.04, 0.18, 0.34, 0.41, 88, "ELEVATED", "中段跟随长端上移,但弱于10Y/30Y——供给冲击集中在长端。"),
  N("us20y", "美国20年期国债收益率", "rates", "P3", 4.92, "%", 0.05, 0.27, 0.49, 0.58, 95, "EXTREME", "20Y流动性最差,供给冲击下表现最弱。"),
  N("us5yreal", "美国5年期实际利率", "rates", "P2", 2.05, "%", 0.03, 0.14, 0.26, 0.31, 89, "ELEVATED", "中段实际利率同步上行,幅度小于10Y。"),
  N("cutsexp", "市场隐含未来12个月降息次数", "rates", "P1", 1.6, "次", 0.0, -0.2, -0.4, -0.6, 38, "NORMAL",
    "降息预期仅温和回落——与利率大幅上行不匹配,佐证本轮非政策预期驱动。",
    "若降息预期快速归零且美元走强,主导解释切换为政策转鹰(路径A)。"),
  N("netissue", "美国国债季度净发行量", "risk", "P0", 7820, "亿$", 0, 120, 460, 980, 97, "EXTREME",
    "再融资规模连续上修,长债占比提升,是本轮期限溢价上行的直接供给来源。",
    "若财政部下调发行指引或缩短久期结构,供给压力链条降级。"),
  N("auctiontail", "美国国债拍卖尾差", "risk", "P1", 3.1, "bp", 0.2, 0.8, 1.4, 1.8, 93, "EXTREME", "近三次10Y/30Y拍卖连续出现明显尾差,需求消化吃力。"),
  N("bidcover", "美国国债投标倍数", "risk", "P1", 2.31, "x", -0.01, -0.05, -0.11, -0.14, 8, "ELEVATED", "投标倍数降至低分位,与尾差互相印证需求走弱。"),
  N("dealerinv", "美国一级交易商国债库存", "risk", "P2", 3120, "亿$", 15, 90, 240, 380, 91, "ELEVATED", "做市商被动吸收供给,库存接近历史高位,定价能力受限。"),
  N("usdeficit", "美国财政赤字(12M滚动)", "risk", "P1", -1.92, "万亿$", 0.0, -0.02, -0.06, -0.13, 96, "EXTREME", "赤字率在非衰退期罕见走阔,是净发行压力的源头。"),
  N("fiscalimpulse", "美国财政冲量", "risk", "P3", 0.8, "%GDP", 0.0, 0.1, 0.2, 0.3, 82, "NORMAL", "财政对增长的边际贡献仍为正。"),
  N("tga", "美国财政部TGA账户", "liquidity", "P1", 7350, "亿$", -20, -180, -350, 280, 62, "NORMAL", "TGA回落部分对冲发行抽水,缓和银行体系流动性。"),
  N("reserves", "美国银行准备金", "liquidity", "P1", 3.28, "万亿$", 0.00, -0.02, -0.05, -0.11, 41, "NORMAL", "准备金仍处\u201c充裕\u201d区间,未见融资压力信号。"),
  N("mmf", "美国货币市场基金规模", "liquidity", "P2", 6.41, "万亿$", 0.01, 0.05, 0.12, 0.31, 98, "NORMAL", "高收益短端持续吸金,货基规模创新高。"),

  /* ====== 扩展: 中国利率与信用 (模拟数据) ====== */
  N("cn1y", "中国1年期国债收益率", "rates", "P3", 1.42, "%", 0.00, 0.02, 0.04, -0.06, 35, "NORMAL", "短端围绕资金面波动。"),
  N("cn5y", "中国5年期国债收益率", "rates", "P3", 1.78, "%", 0.01, 0.03, 0.05, -0.04, 38, "NORMAL", "中段平稳。"),
  N("cn30y", "中国30年期国债收益率", "rates", "P2", 2.28, "%", 0.01, 0.04, 0.08, -0.02, 42, "NORMAL", "超长端配置盘主导,与美债长端走势脱敏。"),
  N("lpr5y", "5年期LPR", "rates", "P3", 3.50, "%", 0.0, 0.0, 0.0, -0.10, 30, "NORMAL", "按揭定价基准,政策调降后持稳。"),
  N("dr001", "DR001", "rates", "P3", 1.52, "%", 0.02, 0.05, 0.03, -0.08, 44, "NORMAL", "隔夜资金利率平稳。"),
  N("shibor3m", "SHIBOR 3个月", "rates", "P3", 1.71, "%", 0.00, 0.02, 0.04, -0.05, 40, "NORMAL", "银行间中期资金成本。"),
  N("ncd1y", "AAA同业存单1年期收益率", "rates", "P2", 1.86, "%", 0.01, 0.03, 0.06, -0.04, 45, "NORMAL", "银行负债端边际定价,流动性压力的前哨指标。"),
  N("cnusspread", "中美国债10年利差", "rates", "P2", -2.50, "%", -0.04, -0.27, -0.46, -0.50, 4, "EXTREME", "倒挂幅度随美债上行再度走阔,人民币汇率的关键约束。"),
  N("cnchengtou", "中国城投债利差", "credit", "P1", 1.12, "%", 0.00, -0.02, -0.06, -0.15, 18, "NORMAL", "化债推进下城投利差持续压缩。"),
  N("cnpropcredit", "中国房地产债信用利差", "credit", "P1", 4.85, "%", 0.03, 0.10, 0.22, 0.35, 86, "ELEVATED", "地产销售走弱背景下,民企地产债利差再度走阔。"),
  N("cnaaa", "中国AAA信用债利差", "credit", "P2", 0.42, "%", 0.00, 0.01, 0.02, -0.03, 35, "NORMAL", "高等级信用利差低位平稳。"),

  /* ====== 扩展: 美国增长与就业 (模拟数据) ====== */
  N("ismneworder", "ISM制造业新订单", "growth", "P1", 49.2, "idx", 0.0, -0.6, -1.3, -2.1, 36, "NORMAL", "新订单徘徊于荣枯线下方,需求端未现再加速。"),
  N("ismserv", "ISM服务业PMI", "growth", "P1", 52.4, "idx", 0.0, -0.3, -0.8, -0.4, 55, "NORMAL", "服务业维持温和扩张。"),
  N("usretail", "美国零售销售(环比)", "growth", "P2", 0.3, "%", 0.0, 0.0, -0.2, -0.3, 58, "NORMAL", "消费动能边际放缓但仍有韧性。"),
  N("gdpnow", "亚特兰大联储GDPNow", "growth", "P2", 2.1, "%", 0.0, -0.2, -0.4, -0.7, 52, "NORMAL", "增长跟踪温和——利率上行并非增长预期驱动,佐证供给叙事。"),
  N("usconf", "美国消费者信心", "growth", "P2", 98.4, "idx", -0.5, -2.1, -4.3, -6.0, 31, "NORMAL", "信心受高利率与物价拖累。"),
  N("housingstarts", "美国住房开工", "growth", "P2", 128.2, "万套", -1.2, -4.5, -8.9, -12.1, 14, "ELEVATED", "长端利率上行直接压制地产开工——利率敏感部门最先受损。"),
  N("jolts", "JOLTS职位空缺", "growth", "P2", 742, "万", 0, -12, -30, -55, 42, "NORMAL", "劳动力市场降温但未失速。"),
  N("ahe", "美国平均时薪(同比)", "growth", "P2", 3.9, "%YoY", 0.0, 0.0, -0.1, -0.2, 60, "NORMAL", "薪资增速缓步回落,不构成通胀再加速证据。"),

  /* ====== 扩展: 中国增长/地产/信用周期 (模拟数据) ====== */
  N("cxpmi", "财新制造业PMI", "growth", "P2", 50.4, "idx", 0.0, 0.1, 0.3, 0.5, 58, "NORMAL", "中小出口型企业景气度略好于官方口径。"),
  N("pminewexport", "PMI新出口订单", "growth", "P3", 48.9, "idx", 0.0, 0.2, 0.5, 0.8, 49, "NORMAL", "外需边际改善但仍处收缩区。"),
  N("creditimpulse", "中国信用脉冲", "growth", "P0", -1.2, "%GDP", 0.0, 0.2, 0.6, 1.1, 38, "NORMAL",
    "信用脉冲处于回升早期,尚未传导至实体需求——决定铜与周期股的中期方向。",
    "若信用脉冲转正且企业中长贷连续改善,中国信用扩张路径(C)激活。"),
  N("corploan", "企业中长期贷款(同比多增)", "growth", "P1", -820, "亿元", 0, 150, 420, 680, 33, "NORMAL", "企业融资需求修复缓慢,信用扩张的关键观察项。"),
  N("hhloanlt", "居民中长期贷款(同比多增)", "growth", "P2", -1240, "亿元", 0, -80, -260, -410, 12, "ELEVATED", "按揭需求疲弱,与地产销售互相印证。"),
  N("lgsb", "地方政府专项债发行", "liquidity", "P2", 6800, "亿元", 0, 420, 1500, 2800, 78, "NORMAL", "专项债前置发行支撑基建。"),
  N("reinvest", "房地产开发投资(累计同比)", "growth", "P1", -9.8, "%YoY", 0.0, -0.3, -0.8, -1.5, 6, "EXTREME",
    "地产投资降幅再度扩大,地产下行路径(G)的核心节点。"),
  N("propsales", "商品房销售面积(同比)", "growth", "P1", -16.4, "%YoY", 0.0, -1.2, -3.5, -6.0, 5, "EXTREME", "销售端未见底,负反馈仍在向投资与信用传导。"),
  N("newstarts", "房屋新开工面积(同比)", "growth", "P2", -22.1, "%YoY", 0.0, -1.5, -3.8, -5.2, 4, "EXTREME", "新开工深度收缩,直接压制钢铁与建材需求。"),
  N("infrainvest", "基础设施投资(累计同比)", "growth", "P2", 6.2, "%YoY", 0.0, 0.2, 0.5, 0.9, 72, "NORMAL", "基建对冲地产,专项债资金到位支撑。"),
  N("mfginvest", "制造业投资(累计同比)", "growth", "P3", 8.1, "%YoY", 0.0, 0.1, 0.3, 0.4, 80, "NORMAL", "设备更新驱动制造业投资高位。"),
  N("power", "发电量(同比)", "growth", "P3", 4.3, "%YoY", 0.0, 0.2, 0.6, 0.8, 64, "NORMAL", "电量增速验证实体活动温和。"),

  /* ====== 扩展: 通胀与供应链 (模拟数据) ====== */
  N("usppi", "美国PPI(同比)", "inflation", "P2", 2.6, "%YoY", 0.0, 0.1, 0.3, 0.4, 70, "NORMAL", "上游价格温和回升,尚未失控。"),
  N("rentcpi", "美国租金通胀(同比)", "inflation", "P2", 4.1, "%YoY", 0.0, -0.1, -0.3, -0.6, 66, "NORMAL", "租金分项延续缓慢降温,核心通胀的最大权重项。"),
  N("gasoline", "美国汽油零售价", "inflation", "P2", 3.42, "$/gal", 0.01, 0.06, 0.15, 0.22, 71, "NORMAL", "油价上行逐步传导至终端。"),
  N("cncorecpi", "中国核心CPI(同比)", "inflation", "P2", 0.6, "%YoY", 0.0, 0.0, 0.1, 0.1, 34, "NORMAL", "内需偏弱,核心通胀低位。"),
  N("ppirm", "中国PPIRM(同比)", "inflation", "P3", -2.1, "%YoY", 0.0, 0.2, 0.5, 0.8, 28, "NORMAL", "购进价格降幅收窄。"),
  N("pmiraw", "PMI原材料购进价格", "inflation", "P3", 52.8, "idx", 0.0, 0.5, 1.2, 1.8, 68, "NORMAL", "上游涨价向中游传导的先行信号。"),
  N("gscpi", "全球供应链压力指数", "inflation", "P2", 0.31, "σ", 0.00, 0.05, 0.12, 0.20, 62, "NORMAL", "供应链压力略高于中性,未现系统性紧张。"),
  N("bdi", "波罗的海干散货指数", "inflation", "P3", 1840, "idx", 12, 65, 140, 220, 58, "NORMAL", "干散运价反映大宗实物需求温和。"),

  /* ====== 扩展: 全球流动性与财政 (模拟数据) ====== */
  N("sloos", "美国银行贷款标准(收紧净占比)", "liquidity", "P2", 8.4, "%", 0.0, -0.5, -1.8, -4.2, 55, "NORMAL", "信贷标准边际放松,信用渠道未受利率冲击。"),
  N("bankloans", "美国商业银行贷款(同比)", "liquidity", "P2", 3.1, "%YoY", 0.0, 0.1, 0.2, 0.4, 48, "NORMAL", "银行信贷温和扩张。"),
  N("pbocbs", "中国央行资产负债表", "liquidity", "P2", 45.8, "万亿元", 0.0, 0.1, 0.4, 0.9, 75, "NORMAL", "央行扩表配合政府债发行。"),
  N("cngovbond", "中国政府债券净融资", "liquidity", "P2", 9200, "亿元", 0, 600, 2100, 3500, 84, "NORMAL", "政府债供给放量,社融的主要支撑项。"),
  N("landsales", "中国土地出让收入(同比)", "liquidity", "P2", -18.6, "%YoY", 0.0, -0.8, -2.2, -4.0, 7, "ELEVATED", "土地财政持续收缩,地方财力与地产负反馈的交点。"),

  /* ====== 扩展: 信用与金融压力 (模拟数据) ====== */
  N("cdxig", "CDX IG", "credit", "P2", 52.4, "bp", 0.1, 0.5, 0.8, -1.2, 38, "NORMAL", "投资级CDS平稳,信用市场未跟随利率恐慌。"),
  N("cdxhy", "CDX HY", "credit", "P2", 328, "bp", 1, 4, 7, -10, 41, "NORMAL", "高收益CDS小幅走阔,远未到压力区。"),
  N("vvix", "VVIX", "credit", "P2", 92.5, "idx", 0.8, 3.2, 6.5, 4.1, 71, "NORMAL", "波动率的波动率抬升,尾部对冲需求增加。"),
  N("hydefault", "美国高收益债违约率", "credit", "P2", 2.8, "%", 0.0, 0.0, 0.1, 0.2, 52, "NORMAL", "违约率处于历史均值附近,基本面未恶化。"),
  N("bankcds", "美国银行CDS指数", "credit", "P2", 78.2, "bp", 0.5, 2.1, 4.0, 3.2, 64, "NORMAL", "银行CDS小幅走阔——关注长端利率对银行债券浮亏的压力。"),
  N("cnliqstress", "中国银行间流动性压力", "credit", "P2", 0.22, "σ", 0.00, 0.02, 0.04, -0.06, 40, "NORMAL", "银行间流动性平稳,无跨季压力。"),

  /* ====== 扩展: 商品供需与库存 (模拟数据) ====== */
  N("brent", "Brent原油", "asset", "P2", 88.9, "$/bbl", 0.5, 2.0, 3.8, 6.1, 60, "ELEVATED", "与WTI同步,布伦特溢价稳定。"),
  N("natgas", "美国天然气", "asset", "P2", 2.84, "$/mmbtu", 0.02, 0.10, 0.18, -0.30, 45, "NORMAL", "气价区间震荡,供需双弱。"),
  N("silver", "白银", "asset", "P2", 34.2, "$/oz", 0.3, 1.4, 2.6, 4.1, 93, "ELEVATED", "跟随黄金上行,贵金属对冲需求外溢。"),
  N("aluminum", "铝(LME)", "asset", "P3", 2640, "$/t", 8, 35, 80, 120, 72, "NORMAL", "电解铝供给受限,价格高位。"),
  N("ironore", "铁矿石", "asset", "P2", 96.5, "$/t", -0.8, -2.4, -5.1, -8.3, 22, "ELEVATED", "地产新开工收缩直接压制矿价——地产下行路径(G)的价格端确认。"),
  N("rebar", "螺纹钢", "asset", "P3", 3280, "元/t", -12, -45, -110, -180, 18, "NORMAL", "建材需求弱势,钢价承压。"),
  N("usoilinv", "美国原油库存", "asset", "P2", 4.31, "亿桶", -0.02, -0.08, -0.15, -0.28, 24, "NORMAL", "库存持续去化,支撑油价底部。"),
  N("rigcount", "美国钻机数量", "asset", "P3", 512, "台", -1, -4, -9, -18, 28, "NORMAL", "资本开支纪律下钻机回落,供给弹性受限。"),
  N("lmecopperinv", "LME铜库存", "asset", "P2", 12.4, "万吨", -0.2, -0.8, -1.9, -3.5, 9, "ELEVATED", "显性库存低位,铜价对需求信号高度敏感。"),
  N("oilterm", "原油期限结构(M1-M12)", "asset", "P2", 4.2, "$/bbl", 0.1, 0.4, 0.9, 1.3, 82, "NORMAL", "现货升水加深,实物市场偏紧的直接证据。"),
  N("shlngold", "上海-伦敦黄金溢价", "asset", "P3", 28.5, "$/oz", 0.5, 2.1, 5.4, 9.0, 91, "ELEVATED", "境内溢价高企,反映人民币计价的黄金配置需求旺盛。"),
  N("opecprod", "OPEC原油产量", "asset", "P3", 2685, "万桶/日", 0, -8, -20, -45, 15, "NORMAL", "减产执行率高,供给端持续收紧。"),

  /* ====== 扩展: 资金流与仓位 (模拟数据) ====== */
  N("goldetfflow", "全球黄金ETF资金流(4周)", "liquidity", "P1", 86.4, "亿$", 2.1, 12.5, 28.0, 41.0, 96, "EXTREME",
    "黄金ETF持续大额净流入——财政信用对冲需求的资金面证据,支撑\u201c黄金上涨非投机\u201d判断。"),
  N("cftcgold", "CFTC黄金净多头", "liquidity", "P2", 24.8, "万手", 0.4, 1.8, 3.5, 5.2, 88, "ELEVATED", "投机净多头高位但未极端,挤仓风险可控。"),
  N("usequityflow", "美国股票ETF资金流(4周)", "liquidity", "P2", -124, "亿$", -8, -35, -60, 45, 18, "NORMAL", "股票资金转为净流出,与利率冲击一致。"),
  N("putcall", "股票Put/Call比例", "liquidity", "P2", 1.08, "x", 0.01, 0.05, 0.12, 0.09, 76, "NORMAL", "对冲需求抬升,情绪偏防御。"),
  N("cta", "CTA趋势仓位代理", "liquidity", "P2", -0.6, "σ", -0.1, -0.3, -0.8, -1.1, 24, "NORMAL", "趋势资金已转向做空债券、减持股票。"),
  N("gammaproxy", "期权做市商Gamma代理", "liquidity", "P2", -0.4, "σ", -0.1, -0.2, -0.5, -0.3, 28, "NORMAL", "负Gamma环境放大日内波动。"),
  N("margindebt", "融资余额(A股)", "liquidity", "P3", 1.62, "万亿元", 0.00, 0.01, 0.03, 0.06, 70, "NORMAL", "杠杆资金温和回升。"),
  N("buyback", "美国股票回购规模(季)", "liquidity", "P2", 2280, "亿$", 0, 15, 40, 95, 80, "NORMAL", "回购仍是美股最大边际买家,托底估值。"),

  /* ====== 扩展: 资产与风格 (模拟数据) ====== */
  N("rut", "罗素2000", "asset", "P2", 2208, "idx", -0.6, -2.8, -4.5, -2.1, 35, "NORMAL", "小盘股受融资成本冲击,弱于大盘。"),
  N("sox", "美国半导体指数(SOX)", "asset", "P1", 5240, "idx", -1.8, -6.2, -9.4, -4.8, 60, "EXTREME", "最长久期的成长资产,实际利率上行下领跌——本轮利率冲击的风险放大器。"),
  N("tlt", "美国长期国债指数(TLT)", "asset", "P2", 84.2, "idx", -0.5, -2.4, -4.6, -6.0, 3, "EXTREME", "长债指数创阶段新低,久期资产全面承压。"),
  N("utilities", "美国公用事业指数", "asset", "P3", 412, "idx", -0.4, -1.8, -3.2, -2.5, 30, "NORMAL", "类债券板块随利率上行走弱。"),
  N("reits", "美国房地产REITs", "asset", "P3", 88.6, "idx", -0.7, -2.9, -5.0, -4.1, 12, "ELEVATED", "利率敏感+再融资压力双重打击。"),
  N("csi500", "中证500", "asset", "P2", 6850, "idx", 0.2, 0.8, 1.5, 3.2, 62, "NORMAL", "中盘成长温和走强,内资定价为主。"),
  N("chinext", "创业板指", "asset", "P2", 2480, "idx", 0.3, 1.1, 2.0, 4.5, 60, "NORMAL", "国内流动性宽松支撑成长风格。"),
  N("hstech", "恒生科技", "asset", "P2", 5120, "idx", -0.4, -1.2, -0.8, 2.1, 55, "NORMAL", "离岸科技受美债利率与国内政策双重定价。"),
  N("dividendetf", "红利ETF", "asset", "P2", 1.42, "idx", 0.1, 0.6, 1.4, 2.8, 78, "NORMAL", "高股息防御属性在利率冲击中相对抗跌。"),
  N("goldetf", "黄金ETF(518880)", "asset", "P3", 6.84, "元", 0.6, 3.2, 5.8, 9.1, 97, "ELEVATED", "境内黄金ETF份额与净值齐升。"),

  /* ====== 扩展: Regime/风险状态节点 (模拟数据, 特殊视觉) ====== */
  N("usepu", "美国经济政策不确定性", "risk", "P2", 162, "idx", 2, 8, 18, 25, 78, "NORMAL", "财政与监管政策不确定性抬升。"),
  N("cnepu", "中国经济政策不确定性", "risk", "P3", 138, "idx", 1, 4, 8, -12, 55, "NORMAL", "政策预期相对平稳。"),
  N("cnpropregime", "中国房地产政策状态", "risk", "P2", 0.4, "σ", 0.0, 0.0, 0.1, 0.2, 58, "NORMAL", "政策处于\u201c托而不举\u201d状态,放松空间仍在。"),
  N("usbankrisk", "美国银行体系风险状态", "risk", "P2", 0.6, "σ", 0.0, 0.1, 0.2, 0.2, 68, "NORMAL", "长端利率上行重新拉大银行债券浮亏,风险状态由低位抬头。"),
  N("liqcrisis", "全球流动性危机状态", "risk", "P1", 0.2, "σ", 0.0, 0.0, 0.1, 0.0, 42, "NORMAL",
    "融资市场平稳,流动性冲击路径(E)处于休眠——一旦激活,所有资产相关性趋同。",
    "若FRA-OIS、交叉货币基差与HY利差同步异动,该状态节点升级并覆盖其他路径。"),
  N("reflation", "再通胀状态", "risk", "P1", 0.3, "σ", 0.0, 0.0, 0.1, 0.2, 50, "NORMAL", "增长端未确认,再通胀路径(F)尚未激活。"),
  N("recession", "衰退状态", "risk", "P1", 0.25, "σ", 0.0, 0.0, 0.0, -0.1, 35, "NORMAL", "就业与信用利差均未给出衰退信号,路径(H)休眠。"),
  N("stagflation", "滞胀状态", "risk", "P2", 0.45, "σ", 0.0, 0.1, 0.1, 0.2, 62, "NORMAL", "利率上行+增长平淡的组合带有轻度滞胀气味,尚不构成主导。"),
  N("riskoff", "Risk-off状态", "risk", "P1", 0.35, "σ", 0.0, 0.1, 0.2, 0.1, 56, "NORMAL", "避险情绪温和——典型risk-off中美元黄金齐涨,当前美元走弱说明并非全面避险。"),
];

/* ----------------------- 模拟数据:边 ----------------------- */
// E(id, source, target, relation, status, mechanism, strength)
const E = (id, source, target, relation, status, mechanism, strength) =>
  ({ id, source, target, relation, status, mechanism, strength });

const RAW_EDGES = [
  // 主导路径:财政供给 → 期限溢价 → 长端 → 实际利率 → 成长股
  E("e_supply_tp", "fiscalsupply", "termprem", "positive", "ACTIVE", "国债净供给放量推升期限溢价", 0.9),
  E("e_worry_tp", "fiscalworry", "termprem", "positive", "ACTIVE", "财政可持续性担忧要求更高久期补偿", 0.8),
  E("e_tp_10y", "termprem", "us10y", "positive", "ACTIVE", "期限溢价走阔直接抬升长端名义利率", 0.9),
  E("e_10y_real", "us10y", "us10yreal", "positive", "ACTIVE", "名义上行+盈亏平衡持稳 → 实际利率上行", 0.85),
  E("e_real_ndx", "us10yreal", "ndx", "negative", "ACTIVE", "实际利率上行压制长久期成长估值", 0.85),
  E("e_real_growth", "us10yreal", "growthidx", "negative", "ACTIVE", "贴现率冲击集中作用于成长风格", 0.7),
  E("e_move_tp", "move", "termprem", "positive", "ACTIVE", "利率波动率上行抬升期限溢价补偿", 0.6),
  E("e_supply_worry", "fiscalsupply", "fiscalworry", "positive", "ACTIVE", "供给压力强化财政可持续性担忧", 0.6),
  E("e_worry_gold", "fiscalworry", "gold", "positive", "ACTIVE", "法币信用对冲需求推升黄金", 0.75),
  E("e_worry_dxy", "fiscalworry", "dxy", "negative", "ACTIVE", "财政信用担忧驱动美元贬值压力", 0.7),
  E("e_10y_bank", "us10y", "bankidx", "positive", "ACTIVE", "利率上行+曲线陡峭化改善银行息差", 0.6),

  // 背离边
  E("e_real_gold", "us10yreal", "gold", "negative", "DIVERGENCE", "实际利率与黄金的传统负相关本期失效:同步上行", 0.8),
  E("e_10y_dxy", "us10y", "dxy", "positive", "DIVERGENCE", "利差逻辑被资金流出与财政信用担忧抵消:收益率↑美元↓", 0.8),
  E("e_spx_hy", "spx", "hyspread", "negative", "DIVERGENCE", "股票下跌但信用利差未走阔,信用市场未确认风险", 0.7),
  E("e_oil_be", "oil", "us10ybe", "positive", "DIVERGENCE", "油价上行未带动盈亏平衡通胀,通胀预期未确认", 0.55),
  E("e_style", "growthidx", "valueidx", "conditional", "DIVERGENCE", "成长/价值风格剧烈分化:利率冲击下的内部撕裂", 0.6),

  // 失效边
  E("e_fed_dxy", "fedpath", "dxy", "positive", "INVALIDATED", "『鹰派预期→强美元』机制当前被财政信用溢价覆盖,逻辑可能失效", 0.6),

  // 利率内部
  E("e_fed_2y", "fedpath", "us2y", "positive", "INACTIVE", "政策路径预期锚定短端", 0.8),
  E("e_2y_10y", "us2y", "us10y", "positive", "INACTIVE", "短端预期沿曲线传导", 0.5),
  E("e_be_10y", "us10ybe", "us10y", "positive", "INACTIVE", "通胀补偿构成名义利率", 0.5),
  E("e_ff_fedpath", "fedfunds", "fedpath", "positive", "INACTIVE", "现行利率构成路径起点", 0.4),
  E("e_10y_30y", "us10y", "us30y", "positive", "INACTIVE", "长端联动,超长端对供给更敏感", 0.7),
  E("e_10y_curve", "us10y", "t2s10s", "positive", "INACTIVE", "长端领涨推动曲线熊陡", 0.6),
  E("e_jgb_10y", "jgb10y", "us10y", "positive", "INACTIVE", "全球久期供需联动,日债上行外溢", 0.4),
  E("e_bund_10y", "bund10y", "us10y", "positive", "INACTIVE", "欧美利率联动", 0.35),
  E("e_real_chip", "us10yreal", "chipetf", "negative", "INACTIVE", "实际利率冲击高久期科技资产", 0.55),
  E("e_10y_value", "us10y", "valueidx", "positive", "INACTIVE", "利率上行环境利好价值风格", 0.5),

  // 通胀 → 政策
  E("e_cpi_fed", "uscpi", "fedpath", "positive", "INACTIVE", "通胀粘性约束降息节奏", 0.65),
  E("e_core_fed", "uscorecpi", "fedpath", "positive", "INACTIVE", "核心通胀决定政策容忍度", 0.6),
  E("e_pce_fed", "uspce", "fedpath", "positive", "INACTIVE", "联储目标口径直接输入反应函数", 0.6),
  E("e_nfp_fed", "nfp", "fedpath", "positive", "INACTIVE", "就业强度影响政策预期", 0.5),
  E("e_claims_fed", "usclaims", "fedpath", "negative", "INACTIVE", "初请上行→宽松预期升温", 0.4),
  E("e_unemp_fed", "unemp", "fedpath", "negative", "INACTIVE", "失业率抬升触发宽松定价", 0.45),
  E("e_oil_cpi", "oil", "uscpi", "positive", "INACTIVE", "能源价格直接传导至总体CPI", 0.6),
  E("e_crb_cpi", "crb", "uscpi", "positive", "INACTIVE", "商品价格领先商品通胀分项", 0.45),
  E("e_oil_ppi", "oil", "cnppi", "positive", "INACTIVE", "输入性成本影响PPI", 0.5),

  // 中国需求链(激活)
  E("e_neworder_dem", "cnpminew", "inddemand", "positive", "ACTIVE", "新订单领先工业品实物需求", 0.7),
  E("e_dem_copper", "inddemand", "copper", "positive", "ACTIVE", "需求改善推升铜价", 0.7),
  E("e_copper_com", "copper", "comidx", "positive", "ACTIVE", "铜价带动商品指数走强", 0.6),

  // 中国内部
  E("e_fai_dem", "fai", "inddemand", "positive", "INACTIVE", "投资形成实物工作量", 0.5),
  E("e_indprod_dem", "indprod", "inddemand", "positive", "INACTIVE", "生产与需求互为印证", 0.4),
  E("e_export_pmi", "exports", "cnpmi", "positive", "INACTIVE", "外需支撑制造业景气", 0.5),
  E("e_retail_pmi", "retail", "cnpmi", "positive", "INACTIVE", "内需影响制造业订单", 0.35),
  E("e_pmi_ppi", "cnpmi", "cnppi", "positive", "INACTIVE", "景气回升收窄PPI跌幅", 0.5),
  E("e_tsf_pmi", "tsf", "cnpmi", "positive", "INACTIVE", "信用扩张领先景气约2个季度", 0.55),
  E("e_m2_tsf", "m2", "tsf", "positive", "INACTIVE", "货币与信用总量联动", 0.4),
  E("e_m1_csi", "m1", "csi300", "positive", "INACTIVE", "企业活化资金领先权益风险偏好", 0.5),
  E("e_pboc_dr", "pboc", "dr007", "negative", "INACTIVE", "净投放压低资金利率", 0.6),
  E("e_dr_r007", "dr007", "r007", "positive", "INACTIVE", "资金利率分层传导", 0.7),
  E("e_r007_cn10y", "r007", "cn10y", "positive", "INACTIVE", "资金面锚定中债短端与长端", 0.5),
  E("e_mlf_lpr", "mlf", "lpr", "positive", "INACTIVE", "政策利率向贷款利率传导", 0.6),
  E("e_lpr_fai", "lpr", "fai", "negative", "INACTIVE", "融资成本影响投资意愿", 0.4),
  E("e_cn10y_fut", "cn10y", "cnbond", "negative", "INACTIVE", "收益率与债券期货价格反向", 0.8),
  E("e_csi_convert", "csi300", "convert", "positive", "INACTIVE", "正股驱动转债", 0.6),
  E("e_csi_hsi", "csi300", "hsi", "positive", "INACTIVE", "中国资产联动", 0.5),
  E("e_nb_csi", "northbound", "csi300", "positive", "INACTIVE", "外资流入边际定价A股", 0.4),

  // 美元传导
  E("e_dxy_gold", "dxy", "gold", "negative", "INACTIVE", "美元计价效应", 0.5),
  E("e_dxy_cny", "dxy", "usdcny", "positive", "INACTIVE", "美元强弱主导人民币双边汇率", 0.7),
  E("e_dxy_eur", "dxy", "eurusd", "negative", "INACTIVE", "指数权重镜像关系", 0.8),
  E("e_dxy_jpy", "dxy", "usdjpy", "positive", "INACTIVE", "美日利差与美元定价", 0.6),
  E("e_dxy_cnh", "dxy", "usdcnh", "positive", "INACTIVE", "离岸联动", 0.6),
  E("e_dxy_gbp", "dxy", "gbpusd", "negative", "INACTIVE", "镜像关系", 0.6),
  E("e_dxy_aud", "dxy", "audusd", "negative", "INACTIVE", "美元与商品货币反向", 0.5),
  E("e_dxy_em", "dxy", "em", "negative", "INACTIVE", "弱美元缓解新兴市场金融条件", 0.6),
  E("e_dxy_copper", "dxy", "copper", "negative", "INACTIVE", "美元计价商品反向", 0.45),

  // 金融条件与信用
  E("e_fedbs_fci", "fedbs", "usfci", "negative", "INACTIVE", "缩表边际收紧金融条件", 0.45),
  E("e_rrp_fci", "rrp", "usfci", "positive", "INACTIVE", "RRP回升抽走体系流动性, 边际收紧金融条件", 0.35),
  E("e_fci_spx", "usfci", "spx", "negative", "INACTIVE", "金融条件收紧压制风险资产", 0.6),
  E("e_hy_fci", "hyspread", "usfci", "positive", "INACTIVE", "信用利差是金融条件分项", 0.5),
  E("e_ig_hy", "igspread", "hyspread", "positive", "INACTIVE", "信用利差同向联动", 0.6),
  E("e_vix_spx", "vix", "spx", "negative", "INACTIVE", "波动率与股指反向", 0.7),
  E("e_vix_risk", "vix", "riskappetite", "negative", "INACTIVE", "波动率抬升压制风险偏好", 0.6),
  E("e_move_vix", "move", "vix", "positive", "INACTIVE", "利率波动外溢至股票波动", 0.5),
  E("e_risk_ndx", "riskappetite", "ndx", "positive", "INACTIVE", "风险偏好支撑成长资产", 0.5),
  E("e_risk_em", "riskappetite", "em", "positive", "INACTIVE", "风险偏好驱动新兴市场资金流", 0.45),

  // 资产内部 / 风险事件
  E("e_ndx_spx", "ndx", "spx", "positive", "INACTIVE", "权重股拖累大盘", 0.8),
  E("e_chip_ndx", "chipetf", "ndx", "positive", "INACTIVE", "半导体是纳指核心权重", 0.7),
  E("e_gold_miners", "gold", "goldminers", "positive", "INACTIVE", "矿业股放大金价弹性", 0.7),
  E("e_com_crb", "comidx", "crb", "positive", "INACTIVE", "商品指数联动", 0.5),
  E("e_geo_oil", "geopolitics", "oil", "positive", "INACTIVE", "地缘冲击供给溢价", 0.5),
  E("e_geo_gold", "geopolitics", "gold", "positive", "INACTIVE", "避险需求", 0.45),
  E("e_ceiling_worry", "debtceiling", "fiscalworry", "positive", "INACTIVE", "债务上限博弈放大财政担忧", 0.4),
  E("e_fci_hy2", "usfci", "hyspread", "positive", "INACTIVE", "条件收紧推升再融资成本", 0.4),
  E("e_sofr_fci", "sofr", "usfci", "positive", "INACTIVE", "货币市场利率传导", 0.3),

  /* ====== 扩展边: 美国利率曲线与政策 ====== */
  E("e_3m_2y", "us3m", "us2y", "positive", "INACTIVE", "短端政策锚向2Y传导", 0.5),
  E("e_2y_5y", "us2y", "us5y", "positive", "ACTIVE", "曲线中段联动", 0.6),
  E("e_5y_10y", "us5y", "us10y", "positive", "ACTIVE", "中长端联动", 0.6),
  E("e_10y_20y", "us10y", "us20y", "positive", "ACTIVE", "长端联动, 20Y流动性最差弹性最大", 0.5),
  E("e_20y_30y", "us20y", "us30y", "positive", "ACTIVE", "超长端联动", 0.5),
  E("e_5y_5yreal", "us5y", "us5yreal", "positive", "INACTIVE", "名义分解到中段实际利率", 0.4),
  E("e_5yreal_10yreal", "us5yreal", "us10yreal", "positive", "ACTIVE", "实际利率曲线联动", 0.5),
  E("e_cpi_cuts", "uscpi", "cutsexp", "negative", "INACTIVE", "通胀超预期压缩降息空间", 0.7),
  E("e_core_cuts", "uscorecpi", "cutsexp", "negative", "INACTIVE", "核心通胀决定政策路径", 0.6),
  E("e_nfp_cuts", "nfp", "cutsexp", "negative", "INACTIVE", "就业强劲推迟降息", 0.6),
  E("e_cuts_2y", "cutsexp", "us2y", "negative", "INACTIVE", "降息预期回吐推升短端", 0.8),
  E("e_cuts_fedpath", "cutsexp", "fedpath", "negative", "INACTIVE", "降息次数与政策路径互为镜像", 0.7),
  E("e_ahe_cpi", "ahe", "uscpi", "positive", "INACTIVE", "薪资-物价螺旋通道", 0.4),
  E("e_real_dxy", "us10yreal", "dxy", "positive", "DIVERGENCE", "实际利差吸引资本流入(当前被财政担忧压制)", 0.6),

  /* ====== 扩展边: 财政供给链 (当前激活主线) ====== */
  E("e_fisc_deficit", "fiscalimpulse", "usdeficit", "positive", "INACTIVE", "财政扩张扩大赤字", 0.5),
  E("e_deficit_netissue", "usdeficit", "netissue", "positive", "ACTIVE", "赤字必须由净发行融资", 0.9),
  E("e_netissue_supply", "netissue", "fiscalsupply", "positive", "ACTIVE", "净发行构成供给压力", 0.9),
  E("e_netissue_tail", "netissue", "auctiontail", "positive", "ACTIVE", "供给放量加大拍卖消化难度", 0.7),
  E("e_netissue_bidcover", "netissue", "bidcover", "negative", "ACTIVE", "供给放量稀释投标倍数", 0.7),
  E("e_netissue_dealer", "netissue", "dealerinv", "positive", "ACTIVE", "发行剩余由一级交易商吸收", 0.5),
  E("e_dealer_tail", "dealerinv", "auctiontail", "positive", "ACTIVE", "库存饱和削弱做市承接", 0.5),
  E("e_tail_tp", "auctiontail", "termprem", "positive", "ACTIVE", "需求疲弱直接定价为期限溢价", 0.8),
  E("e_bidcover_tp", "bidcover", "termprem", "negative", "ACTIVE", "投标倍数下降推升期限溢价", 0.7),
  E("e_deficit_worry", "usdeficit", "fiscalworry", "positive", "ACTIVE", "赤字失控引发财政信用担忧", 0.7),
  E("e_netissue_tga", "netissue", "tga", "positive", "INACTIVE", "发行回笼资金进入TGA", 0.4),

  /* ====== 扩展边: 流动性管道 ====== */
  E("e_tga_reserves", "tga", "reserves", "negative", "INACTIVE", "TGA上升抽走银行准备金", 0.7),
  E("e_rrp_reserves", "rrp", "reserves", "negative", "INACTIVE", "RRP与准备金的跷跷板", 0.6),
  E("e_fedbs_reserves", "fedbs", "reserves", "positive", "INACTIVE", "央行资产端决定准备金总量", 0.6),
  E("e_reserves_fci", "reserves", "usfci", "negative", "INACTIVE", "准备金充裕压低融资条件", 0.6),
  E("e_mmf_rrp", "mmf", "rrp", "positive", "INACTIVE", "货基配置短端工具", 0.4),
  E("e_sloos_loans", "sloos", "bankloans", "negative", "INACTIVE", "信贷标准决定信用投放", 0.6),
  E("e_loans_gdpnow", "bankloans", "gdpnow", "positive", "INACTIVE", "信用扩张支撑增长", 0.4),

  /* ====== 扩展边: 美国增长 ====== */
  E("e_ismno_uspmi", "ismneworder", "uspmi", "positive", "INACTIVE", "新订单领先整体PMI", 0.7),
  E("e_ismno_oil", "ismneworder", "oil", "positive", "INACTIVE", "制造业需求驱动能源消费", 0.5),
  E("e_ismserv_gdp", "ismserv", "gdpnow", "positive", "INACTIVE", "服务业主导GDP", 0.5),
  E("e_retail_gdp", "usretail", "gdpnow", "positive", "INACTIVE", "消费贡献增长跟踪", 0.5),
  E("e_conf_retail", "usconf", "usretail", "positive", "INACTIVE", "信心领先消费", 0.4),
  E("e_10y_starts", "us10y", "housingstarts", "negative", "ACTIVE", "按揭利率压制地产开工", 0.5),
  E("e_starts_gdp", "housingstarts", "gdpnow", "positive", "INACTIVE", "地产链拖累增长", 0.4),
  E("e_jolts_ahe", "jolts", "ahe", "positive", "INACTIVE", "职位空缺决定薪资议价", 0.5),
  E("e_nfp_gdpnow", "nfp", "gdpnow", "positive", "INACTIVE", "就业-收入-消费链条", 0.5),
  E("e_gdpnow_hy", "gdpnow", "hyspread", "negative", "INACTIVE", "增长预期决定违约定价", 0.5),

  /* ====== 扩展边: 中国信用与地产 ====== */
  E("e_tsf_impulse", "tsf", "creditimpulse", "positive", "INACTIVE", "社融增量构成信用脉冲", 0.9),
  E("e_corploan_impulse", "corploan", "creditimpulse", "positive", "INACTIVE", "企业中长贷是脉冲质量核心", 0.8),
  E("e_hhlt_impulse", "hhloanlt", "creditimpulse", "positive", "INACTIVE", "居民信贷构成脉冲分项", 0.5),
  E("e_impulse_pminew", "creditimpulse", "cnpminew", "positive", "INACTIVE", "信用领先需求约2-3个季度", 0.7),
  E("e_impulse_cnppi", "creditimpulse", "cnppi", "positive", "INACTIVE", "信用扩张传导至工业品价格", 0.5),
  E("e_impulse_csi", "creditimpulse", "csi300", "positive", "INACTIVE", "信用脉冲领先A股盈利周期", 0.5),
  E("e_lgsb_infra", "lgsb", "infrainvest", "positive", "INACTIVE", "专项债资金落地基建", 0.6),
  E("e_cngovbond_tsf", "cngovbond", "tsf", "positive", "INACTIVE", "政府债是社融主要支撑", 0.6),
  E("e_pbocbs_tsf", "pbocbs", "tsf", "positive", "INACTIVE", "央行扩表配合财政", 0.4),
  E("e_cxpmi_cnpmi", "cxpmi", "cnpmi", "positive", "INACTIVE", "财新与官方口径互证", 0.4),
  E("e_pminewexp_export", "pminewexport", "exports", "positive", "INACTIVE", "新出口订单领先出口", 0.6),
  E("e_propregime_propsales", "cnpropregime", "propsales", "positive", "INACTIVE", "政策放松传导至销售", 0.6),
  E("e_propsales_reinvest", "propsales", "reinvest", "positive", "ACTIVE", "销售回款决定开发投资", 0.8),
  E("e_reinvest_newstarts", "reinvest", "newstarts", "positive", "ACTIVE", "投资收缩压制新开工", 0.6),
  E("e_newstarts_ironore", "newstarts", "ironore", "positive", "ACTIVE", "新开工决定钢材-矿石需求", 0.6),
  E("e_reinvest_ironore", "reinvest", "ironore", "positive", "ACTIVE", "地产投资是矿价核心需求", 0.7),
  E("e_ironore_cnppi", "ironore", "cnppi", "positive", "INACTIVE", "黑色系传导至PPI", 0.5),
  E("e_ironore_rebar", "ironore", "rebar", "positive", "ACTIVE", "成本-成材联动", 0.5),
  E("e_reinvest_propcredit", "reinvest", "cnpropcredit", "negative", "ACTIVE", "基本面恶化推升地产债利差", 0.7),
  E("e_propsales_propcredit", "propsales", "cnpropcredit", "negative", "ACTIVE", "销售决定房企现金流与信用", 0.6),
  E("e_propsales_hhlt", "propsales", "hhloanlt", "positive", "ACTIVE", "销售与按揭互为镜像", 0.6),
  E("e_landsales_infra", "landsales", "infrainvest", "positive", "INACTIVE", "土地财政约束地方基建", 0.4),
  E("e_propcredit_chengtou", "cnpropcredit", "cnchengtou", "positive", "INACTIVE", "地产风险向城投情绪传染", 0.4),
  E("e_chengtou_aaa", "cnchengtou", "cnaaa", "positive", "INACTIVE", "信用利差体系联动", 0.4),
  E("e_mfg_inddem", "mfginvest", "inddemand", "positive", "INACTIVE", "制造业投资支撑工业品需求", 0.4),
  E("e_infra_inddem", "infrainvest", "inddemand", "positive", "INACTIVE", "基建对冲地产需求缺口", 0.5),
  E("e_power_indprod", "power", "indprod", "positive", "INACTIVE", "电量验证工业活动", 0.4),

  /* ====== 扩展边: 中国利率体系 ====== */
  E("e_dr001_dr007", "dr001", "dr007", "positive", "INACTIVE", "隔夜向7天传导", 0.4),
  E("e_dr007_shibor", "dr007", "shibor3m", "positive", "INACTIVE", "资金利率向中期传导", 0.5),
  E("e_shibor_ncd", "shibor3m", "ncd1y", "positive", "INACTIVE", "银行负债成本联动", 0.5),
  E("e_ncd_cn1y", "ncd1y", "cn1y", "positive", "INACTIVE", "存单与短债比价", 0.4),
  E("e_cn1y_cn5y", "cn1y", "cn5y", "positive", "INACTIVE", "曲线短中段联动", 0.5),
  E("e_cn5y_cn10y", "cn5y", "cn10y", "positive", "INACTIVE", "曲线中长段联动", 0.5),
  E("e_cn10y_cn30y", "cn10y", "cn30y", "positive", "INACTIVE", "超长端配置盘联动", 0.5),
  E("e_lpr5_propsales", "lpr5y", "propsales", "negative", "INACTIVE", "按揭利率影响购房意愿", 0.5),
  E("e_us10y_cnus", "us10y", "cnusspread", "negative", "ACTIVE", "美债上行加深中美倒挂", 0.6),
  E("e_cn10y_cnus", "cn10y", "cnusspread", "positive", "INACTIVE", "中债收益率收窄倒挂", 0.6),
  E("e_cnus_cny", "cnusspread", "usdcny", "negative", "ACTIVE", "利差倒挂施压人民币", 0.6),
  E("e_liqstress_dr007", "cnliqstress", "dr007", "positive", "INACTIVE", "流动性压力推升资金利率", 0.5),
  E("e_liqstress_ncd", "cnliqstress", "ncd1y", "positive", "INACTIVE", "压力期存单利率先行", 0.4),

  /* ====== 扩展边: 通胀与供应链 ====== */
  E("e_ppi_cpi", "usppi", "uscpi", "positive", "INACTIVE", "上游向终端传导", 0.5),
  E("e_rent_corecpi", "rentcpi", "uscorecpi", "positive", "INACTIVE", "租金是核心通胀最大权重", 0.6),
  E("e_oil_gasoline", "oil", "gasoline", "positive", "ACTIVE", "原油向零售油价传导", 0.7),
  E("e_gasoline_cpi", "gasoline", "uscpi", "positive", "INACTIVE", "汽油直接计入CPI能源项", 0.6),
  E("e_cncorecpi_cncpi", "cncorecpi", "cncpi", "positive", "INACTIVE", "核心与整体口径联动", 0.5),
  E("e_pmiraw_ppirm", "pmiraw", "ppirm", "positive", "INACTIVE", "购进价格指数领先PPIRM", 0.4),
  E("e_ppirm_cnppi", "ppirm", "cnppi", "positive", "INACTIVE", "购进成本传导至出厂价", 0.5),
  E("e_gscpi_cpi", "gscpi", "uscpi", "positive", "INACTIVE", "供应链压力推升商品通胀", 0.4),
  E("e_bdi_gscpi", "bdi", "gscpi", "positive", "INACTIVE", "运价是供应链压力分项", 0.3),

  /* ====== 扩展边: 信用与压力 ====== */
  E("e_cdxhy_hy", "cdxhy", "hyspread", "positive", "INACTIVE", "CDS与现券利差互证", 0.6),
  E("e_cdxig_ig", "cdxig", "igspread", "positive", "INACTIVE", "CDS与现券利差互证", 0.6),
  E("e_vvix_vix", "vvix", "vix", "positive", "INACTIVE", "波动率曲面联动", 0.6),
  E("e_hydef_hy", "hydefault", "hyspread", "positive", "INACTIVE", "违约率是利差的基本面锚", 0.5),
  E("e_bankcds_bankidx", "bankcds", "bankidx", "negative", "INACTIVE", "信用风险压制银行股估值", 0.5),
  E("e_bankcds_usbankrisk", "bankcds", "usbankrisk", "positive", "INACTIVE", "CDS定价银行体系风险", 0.6),
  E("e_10y_usbankrisk", "us10y", "usbankrisk", "positive", "ACTIVE", "长端上行扩大银行债券浮亏", 0.5),

  /* ====== 扩展边: 商品供需 ====== */
  E("e_oil_brent", "oil", "brent", "positive", "ACTIVE", "两油联动", 0.9),
  E("e_opec_oil", "opecprod", "oil", "negative", "INACTIVE", "供给纪律决定油价底部", 0.6),
  E("e_usoilinv_oil", "usoilinv", "oil", "negative", "INACTIVE", "库存去化支撑价格", 0.6),
  E("e_rig_usoilinv", "rigcount", "usoilinv", "positive", "INACTIVE", "钻机领先供给与补库", 0.3),
  E("e_oilterm_oil", "oilterm", "oil", "positive", "INACTIVE", "升水结构确认现货紧张", 0.4),
  E("e_natgas_cpi", "natgas", "uscpi", "positive", "INACTIVE", "能源价格计入通胀", 0.3),
  E("e_gold_silver", "gold", "silver", "positive", "ACTIVE", "贵金属联动, 白银弹性更高", 0.7),
  E("e_real_silver", "us10yreal", "silver", "negative", "INACTIVE", "实际利率同样定价白银", 0.4),
  E("e_alu_comidx", "aluminum", "comidx", "positive", "INACTIVE", "有色构成商品指数权重", 0.3),
  E("e_lmeinv_copper", "lmecopperinv", "copper", "negative", "INACTIVE", "低库存放大铜价弹性", 0.6),
  E("e_dem_ironore", "inddemand", "ironore", "positive", "INACTIVE", "工业需求决定黑色系", 0.4),
  E("e_shlngold_gold", "shlngold", "gold", "positive", "INACTIVE", "境内溢价反映边际买盘", 0.3),

  /* ====== 扩展边: 资金流与仓位 ====== */
  E("e_worry_goldflow", "fiscalworry", "goldetfflow", "positive", "ACTIVE", "财政担忧驱动配置型买盘", 0.7),
  E("e_goldflow_gold", "goldetfflow", "gold", "positive", "ACTIVE", "ETF流入是金价的资金面确认", 0.8),
  E("e_cftcgold_gold", "cftcgold", "gold", "positive", "INACTIVE", "投机仓位放大波动", 0.4),
  E("e_putcall_vix", "putcall", "vix", "positive", "INACTIVE", "对冲需求推升隐含波动率", 0.4),
  E("e_gamma_vix", "gammaproxy", "vix", "negative", "INACTIVE", "负Gamma放大现实波动", 0.5),
  E("e_cta_spx", "cta", "spx", "positive", "INACTIVE", "趋势资金顺势加压", 0.4),
  E("e_buyback_spx", "buyback", "spx", "positive", "INACTIVE", "回购构成底部买盘", 0.4),
  E("e_usequityflow_spx", "usequityflow", "spx", "positive", "INACTIVE", "资金流与价格互为因果", 0.4),
  E("e_margin_csi", "margindebt", "csi300", "positive", "INACTIVE", "杠杆资金放大A股动量", 0.4),

  /* ====== 扩展边: 资产与风格 ====== */
  E("e_10y_tlt", "us10y", "tlt", "negative", "ACTIVE", "收益率上行=长债指数下跌", 0.7),
  E("e_real_sox", "us10yreal", "sox", "negative", "ACTIVE", "半导体是最长久期成长资产", 0.6),
  E("e_sox_ndx", "sox", "ndx", "positive", "ACTIVE", "半导体领跌拖累纳指", 0.7),
  E("e_sox_chipetf", "sox", "chipetf", "positive", "INACTIVE", "全球半导体联动", 0.5),
  E("e_rut_spx", "rut", "spx", "positive", "INACTIVE", "小盘与大盘β联动", 0.4),
  E("e_10y_utilities", "us10y", "utilities", "negative", "INACTIVE", "类债券板块的利率敏感性", 0.4),
  E("e_10y_reits", "us10y", "reits", "negative", "ACTIVE", "利率+再融资双重压制REITs", 0.5),
  E("e_csi_csi500", "csi300", "csi500", "positive", "INACTIVE", "A股大小盘联动", 0.4),
  E("e_chinext_csi", "chinext", "csi300", "positive", "INACTIVE", "成长与大盘联动", 0.4),
  E("e_hstech_hsi", "hstech", "hsi", "positive", "INACTIVE", "科技权重驱动恒指", 0.5),
  E("e_div_value", "dividendetf", "valueidx", "positive", "INACTIVE", "红利与价值风格同源", 0.4),
  E("e_gold_goldetf", "gold", "goldetf", "positive", "ACTIVE", "金价驱动ETF净值", 0.5),

  /* ====== 扩展边: Regime状态 ====== */
  E("e_usepu_vix", "usepu", "vix", "positive", "INACTIVE", "政策不确定性推升波动率", 0.4),
  E("e_cnepu_csi", "cnepu", "csi300", "negative", "INACTIVE", "政策不确定性压制风险偏好", 0.4),
  E("e_propregime_link", "cnpropregime", "cnpropcredit", "negative", "INACTIVE", "政策放松缓和地产信用", 0.5),
  E("e_usbank_hy", "usbankrisk", "hyspread", "positive", "INACTIVE", "银行体系风险外溢至信用", 0.5),
  E("e_liqc_dxy", "liqcrisis", "dxy", "positive", "INACTIVE", "流动性危机=美元荒", 0.7),
  E("e_dxy_hyspread", "dxy", "hyspread", "positive", "INACTIVE", "美元飙升收紧全球金融条件", 0.5),
  E("e_liqc_hy", "liqcrisis", "hyspread", "positive", "INACTIVE", "融资压力直接走阔利差", 0.7),
  E("e_liqc_gold", "liqcrisis", "gold", "conditional", "INACTIVE", "冲击初期黄金同跌, 后期避险", 0.5),
  E("e_refl_oil", "reflation", "oil", "positive", "INACTIVE", "再通胀确认需要能源配合", 0.5),
  E("e_refl_bankidx", "reflation", "bankidx", "positive", "INACTIVE", "再通胀利好银行息差", 0.4),
  E("e_rec_hy", "recession", "hyspread", "positive", "INACTIVE", "衰退定价首先体现在利差", 0.6),
  E("e_rec_spx", "recession", "spx", "negative", "INACTIVE", "衰退压制盈利与估值", 0.6),
  E("e_stag_gold", "stagflation", "gold", "positive", "INACTIVE", "滞胀是黄金最优环境", 0.5),
  E("e_riskoff_vix", "riskoff", "vix", "positive", "INACTIVE", "避险状态推升波动率", 0.6),
  E("e_riskoff_risk", "riskoff", "riskappetite", "negative", "INACTIVE", "risk-off与风险偏好互为镜像", 0.6),
];

/* ----------------------- 标准传导路径 (独立结构) ----------------------- */
const RAW_PATHS = [
  {
    id: "p_a_hawk", name: "路径A · 美国政策转鹰",
    nodeIds: ["uscpi", "cutsexp", "us2y", "us10y", "us10yreal", "dxy"],
    edgeIds: ["e_cpi_cuts", "e_cuts_2y", "e_2y_10y", "e_10y_real", "e_real_dxy"],
    status: "INACTIVE",
    description: "通胀/就业超预期 → 降息预期回吐 → 短端与实际利率上行 → 美元走强、长久期资产承压。",
    expectedMarketStructure: "美元走强 + 黄金承压 + 成长股下跌 + 短端领涨利率",
    alternativeExplanation: "当前美元走弱、黄金上涨、降息预期仅温和回落,三者均与本路径矛盾——主导逻辑并非政策转鹰。",
    invalidation: "若降息预期快速归零且美元指数转强突破前高,本路径重新成为主导解释。",
  },
  {
    id: "p_b_fiscal", name: "路径B · 财政供给与期限溢价(当前主导)",
    nodeIds: ["usdeficit", "netissue", "auctiontail", "termprem", "us10y", "us10yreal", "ndx"],
    edgeIds: ["e_deficit_netissue", "e_netissue_tail", "e_tail_tp", "e_tp_10y", "e_10y_real", "e_real_ndx"],
    status: "ACTIVE",
    description: "赤字扩大 → 净发行放量 → 拍卖尾差扩大/投标倍数下降 → 期限溢价上行 → 10Y/30Y上行 → 长久期资产承压。替代分支:财政可持续性担忧 → 美元走弱 + 黄金上涨(ETF流入佐证)。",
    expectedMarketStructure: "长端领涨利率(熊陡) + 美元走弱 + 黄金上涨 + 成长/半导体/长债/REITs承压 + 银行与价值相对抗跌 + 信用利差平稳",
    alternativeExplanation: "若为政策转鹰,应看到美元走强与降息预期归零;若为增长走强,应看到GDPNow与新订单上修——两者均未发生。",
    invalidation: "财政部下调发行指引、拍卖尾差连续两次消失、或美元转强黄金转跌,则本路径降级。",
  },
  {
    id: "p_c_cncredit", name: "路径C · 中国信用扩张",
    nodeIds: ["tsf", "creditimpulse", "cnpminew", "inddemand", "copper"],
    edgeIds: ["e_tsf_impulse", "e_impulse_pminew", "e_neworder_dem", "e_dem_copper"],
    status: "INACTIVE",
    description: "社融改善 + 企业中长贷改善 → 信用脉冲回升 → PMI新订单与工业需求改善 → 铜、工业品与周期股上涨。",
    expectedMarketStructure: "铜与商品领涨 + 周期/价值风格占优 + 中债利率温和上行 + 人民币走强",
    alternativeExplanation: "当前社融由政府债支撑、企业中长贷仍弱,脉冲质量不足以驱动需求周期。",
    invalidation: "信用脉冲转正且企业中长贷连续3个月同比多增,本路径激活。",
  },
  {
    id: "p_d_liquidity", name: "路径D · 全球流动性改善",
    nodeIds: ["fedbs", "reserves", "usfci", "hyspread", "spx"],
    edgeIds: ["e_fedbs_reserves", "e_reserves_fci", "e_fci_hy2", "e_spx_hy"],
    status: "INACTIVE",
    description: "联储扩表 + TGA下降 + RRP下降 → 银行准备金改善 → 金融条件放松 → 信用利差收窄 → 风险资产上涨。",
    expectedMarketStructure: "信用利差收窄 + 高β资产领涨 + 美元温和走弱 + 波动率回落",
    alternativeExplanation: "当前准备金平稳但联储未扩表,流动性是中性项而非驱动项。",
    invalidation: "若联储重启扩表或TGA/RRP同步大幅回落,本路径激活。",
  },
  {
    id: "p_e_shock", name: "路径E · 流动性冲击",
    nodeIds: ["liqcrisis", "dxy", "hyspread", "spx"],
    edgeIds: ["e_liqc_dxy", "e_dxy_hyspread", "e_spx_hy"],
    status: "INACTIVE",
    description: "融资压力上升 → 杠杆资金被迫平仓 → 美元走强(美元荒) → 信用利差扩大 → 股债商金初期同步下跌。",
    expectedMarketStructure: "万物齐跌 + 美元独强 + 相关性趋同 + 波动率跳升",
    alternativeExplanation: "当前融资市场平稳、准备金充裕,本路径处于休眠监控状态。",
    invalidation: "FRA-OIS、交叉货币基差与HY利差同步异动即激活,并覆盖其他所有路径。",
  },
  {
    id: "p_f_reflation", name: "路径F · 全球再通胀",
    nodeIds: ["ismneworder", "oil", "us10ybe", "us10y", "bankidx"],
    edgeIds: ["e_ismno_oil", "e_oil_be", "e_be_10y", "e_10y_bank"],
    status: "INACTIVE",
    description: "PMI新订单改善 → 原油/铜/运价上涨 → 通胀预期上行 → 名义收益率上行 → 商品、银行与价值风格占优。",
    expectedMarketStructure: "盈亏平衡领涨利率(而非期限溢价) + 商品全面上涨 + 银行价值占优",
    alternativeExplanation: "当前新订单仍在荣枯线下、盈亏平衡仅温和上行——利率上行由期限溢价而非通胀预期驱动,与本路径区分。",
    invalidation: "若ISM新订单站上52且盈亏平衡通胀领涨名义利率,本路径取代财政路径成为主导。",
  },
  {
    id: "p_g_property", name: "路径G · 中国地产下行",
    nodeIds: ["propsales", "reinvest", "ironore", "cnppi"],
    edgeIds: ["e_propsales_reinvest", "e_reinvest_ironore", "e_ironore_cnppi"],
    status: "ACTIVE",
    description: "商品房销售与新开工下降 → 房地产投资下降 → 钢材/水泥/铁矿石需求下降 → 工业品价格与地产信用承压。",
    expectedMarketStructure: "黑色系商品弱势 + 地产债利差走阔 + 居民中长贷疲弱 + 内需型周期承压",
    alternativeExplanation: "基建与制造业投资部分对冲,商品整体未崩,但黑色系与有色/能源的分化即来自本路径。",
    invalidation: "销售面积同比降幅连续3个月收窄且新开工企稳,本路径降级。",
  },
  {
    id: "p_h_recession", name: "路径H · 风险衰退",
    nodeIds: ["nfp", "gdpnow", "hyspread", "spx"],
    edgeIds: ["e_nfp_gdpnow", "e_gdpnow_hy", "e_spx_hy"],
    status: "INACTIVE",
    description: "就业与新订单恶化 → 增长预期下降 → 信用利差扩大 → 股票与商品下跌、国债上涨;美元与黄金表现取决于流动性阶段。",
    expectedMarketStructure: "利差走阔 + 利率曲线牛陡 + 防御风格占优 + 商品需求定价下跌",
    alternativeExplanation: "当前就业温和、利差平稳,衰退路径无证据;若激活,将与财政供给路径在债券方向上正面冲突。",
    invalidation: "非农连续两月低于5万且HY利差突破450bp,本路径激活。",
  },
];
const MOCK_PATHS = RAW_PATHS.map((p) => ({ ...p, label: p.name }));

const MOCK_DIVERGENCES = [
  {
    id: "d1", title: "美债10Y收益率上行,美元指数走弱",
    relatedNodeIds: ["us10y", "dxy", "fiscalworry", "termprem"],
    relatedEdgeIds: ["e_10y_dxy", "e_worry_dxy", "e_worry_tp"],
    expectedRelation: "利差逻辑:美债收益率上行 → 美元走强",
    observedRelation: "10Y +31bp (5D),同期美元指数 −1.6%",
    window: "5D", strength: "HIGH", persistence: "PERSISTENT",
    alternativeExplanations: [
      "利率上行由期限溢价/财政供给驱动,不构成对外资的利差吸引",
      "海外官方部门减持美债,资本流出压制美元",
      "财政信用溢价开始计入汇率定价",
    ],
    invalidationRisk: "HIGH",
  },
  {
    id: "d2", title: "实际利率上行,黄金不跌反涨",
    relatedNodeIds: ["us10yreal", "gold", "fiscalworry"],
    relatedEdgeIds: ["e_real_gold", "e_worry_gold"],
    expectedRelation: "实际利率↑ → 持有黄金机会成本↑ → 金价承压",
    observedRelation: "实际利率 +18bp (5D),黄金 +3.6%",
    window: "5D", strength: "HIGH", persistence: "PERSISTENT",
    alternativeExplanations: [
      "央行购金构成价格不敏感的刚性需求",
      "法币信用/财政可持续性对冲需求上升",
      "去美元化配置与地缘避险叠加",
    ],
    invalidationRisk: "HIGH",
  },
  {
    id: "d3", title: "股票回调,信用利差未扩大",
    relatedNodeIds: ["spx", "ndx", "hyspread", "vix"],
    relatedEdgeIds: ["e_spx_hy"],
    expectedRelation: "风险资产下跌 → 信用利差走阔",
    observedRelation: "SPX −2.4% (5D),HY利差仅 +3bp",
    window: "5D", strength: "MEDIUM", persistence: "TRANSIENT",
    alternativeExplanations: [
      "下跌主因利率端估值压缩,而非盈利或违约风险",
      "成长→价值的风格切换,而非系统性避险",
      "信用市场流动性与再融资环境仍然充裕",
    ],
    invalidationRisk: "MEDIUM",
  },
  {
    id: "d4", title: "原油上行,盈亏平衡通胀未跟随",
    relatedNodeIds: ["oil", "us10ybe"],
    relatedEdgeIds: ["e_oil_be"],
    expectedRelation: "油价↑ → 通胀预期(盈亏平衡)↑",
    observedRelation: "WTI +2.1% (5D),10Y盈亏平衡仅 +4bp",
    window: "5D", strength: "LOW", persistence: "TRANSIENT",
    alternativeExplanations: [
      "市场将油价上行视为暂时性供给扰动",
      "长期通胀预期锚定良好(5y5y稳定)",
      "名义利率上行由期限溢价主导,而非通胀补偿",
    ],
    invalidationRisk: "LOW",
  },
];

const MARKET_STATE = {
  topMover: { nodeId: "us10yreal", text: "美国10Y实际利率 +18bp / 5D · 92分位" },
  dominantPathId: "p_b_fiscal",
  regime: "ELEVATED",
  regimeNote: "驱动更接近财政供给 / 期限溢价 / 财政信用担忧,而非单纯的美联储转鹰。",
};

/* ----------------------- 工具函数 ----------------------- */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2f1b69) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const isPctNode = (n) => n.unit === "%" || n.unit === "%YoY";
function fmtChange(node, v) {
  const sign = v > 0 ? "+" : v < 0 ? "" : "±";
  if (node.unit === "%") return `${sign}${(v * 100).toFixed(0)}bp`;
  if (node.unit === "%YoY") return `${sign}${v.toFixed(1)}pp`;
  if (node.unit === "k" || node.unit === "亿元") return `${sign}${v.toFixed(0)}${node.unit}`;
  return `${sign}${v.toFixed(1)}%`;
}
function fmtValue(node) {
  const v = node.value;
  const s = Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  return `${s}${node.unit && node.unit !== "idx" ? " " + node.unit : node.unit === "idx" ? "" : ""}`;
}
function genHistory(node) {
  const rnd = mulberry32(hashStr(node.id));
  const pts = [];
  const v = node.value;
  const start = isPctNode(node) ? v - node.change60d : v * (1 - node.change60d / 100);
  const vol = (Math.abs(v) * 0.006 + (isPctNode(node) ? 0.015 : 0.01));
  for (let i = 0; i < 60; i++) {
    const base = start + (v - start) * Math.pow(i / 59, 1.4);
    const noise = (rnd() - 0.5) * 2 * vol * (1 + Math.sin(i * 0.7) * 0.3);
    pts.push({ d: 59 - i, value: +(base + (i === 59 ? 0 : noise)).toFixed(3) });
  }
  return pts;
}

/* 球面布局:Fibonacci sphere + 类别中心偏置 */
const SPHERE_R = 10;
function computePositions(nodes) {
  const catKeys = Object.keys(CATS);
  const catDirs = {};
  const golden = Math.PI * (3 - Math.sqrt(5));
  catKeys.forEach((k, i) => {
    const y = 1 - (i / (catKeys.length - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    catDirs[k] = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
  });
  const byCat = {};
  nodes.forEach((n) => { (byCat[n.category] ||= []).push(n); });
  const pos = {};
  Object.entries(byCat).forEach(([cat, arr]) => {
    const dir = catDirs[cat];
    arr.forEach((n, i) => {
      const cnt = arr.length;
      const y = cnt === 1 ? 1 : 1 - (i / (cnt - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i + hashStr(n.id) % 7 * 0.13;
      const fib = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
      const v = fib.multiplyScalar(0.42).add(dir.clone().multiplyScalar(0.58)).normalize();
      const rnd = mulberry32(hashStr(n.id + "p"));
      const prBase = n.priority === "P0" ? 0.84 : n.priority === "P1" ? 0.95 : n.priority === "P2" ? 1.04 : 1.10;
      const radius = SPHERE_R * (prBase + rnd() * 0.06);
      pos[n.id] = v.multiplyScalar(radius);
    });
  });
  return pos;
}

/* ----------------------- 纹理 ----------------------- */
function makeCircleTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.95)");
  g.addColorStop(0.55, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function makeGlowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.3, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function makeRingTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,1)"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.stroke();
  return new THREE.CanvasTexture(c);
}
function makeRegimeTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d");
  // 内核
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 30);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  // 六边形外框
  ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 5;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    const x = 64 + 46 * Math.cos(a), y = 64 + 46 * Math.sin(a);
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  // 第二层细环
  ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.stroke();
  return new THREE.CanvasTexture(c);
}
function makeLabelTexture(text, color) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = "500 40px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w; c.height = 56;
  const ctx2 = c.getContext("2d");
  ctx2.font = font;
  ctx2.fillStyle = color;
  ctx2.shadowColor = "rgba(0,0,0,0.9)"; ctx2.shadowBlur = 6;
  ctx2.textBaseline = "middle";
  ctx2.fillText(text, 12, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / 56 };
}


/* ============================================================
   2D MAP 视图 (原生Canvas 2D, 与3D共享同一份数据与状态)
   ============================================================ */
function Topo2D({ nodes, edges, adjacency, pathEdgeIds, paths, hoverId, selectedId, focusDivId, focusPathId, divergence, visibleSet, searchSet, onHover, onSelect, onClear }) {
  const canvasRef = useRef(null);
  const propsRef = useRef({});
  propsRef.current = { hoverId, selectedId, focusDivId, focusPathId, divergence, visibleSet, searchSet };

  /* 确定性聚类布局: 8类别+Regime=9簇, 簇内 P0中心/P1/P2/P3 同心环 */
  const layout = useMemo(() => {
    const clusterOf = (n) => (REGIME_IDS.has(n.id) ? "regime" : n.category);
    const keys = [...Object.keys(CATS), "regime"];
    const centers = {};
    keys.forEach((k, i) => {
      const a = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
      centers[k] = { x: Math.cos(a) * 560, y: Math.sin(a) * 360 };
    });
    const byCluster = {};
    nodes.forEach((n) => { (byCluster[clusterOf(n)] ||= { P0: [], P1: [], P2: [], P3: [] })[n.priority].push(n); });
    const golden = Math.PI * (3 - Math.sqrt(5));
    const RING = { P0: 34, P1: 96, P2: 158, P3: 214 };
    const pos = new Map();
    Object.entries(byCluster).forEach(([ck, tiers]) => {
      const c = centers[ck] || { x: 0, y: 0 };
      PRIORITIES.forEach((pr) => {
        const arr = tiers[pr];
        arr.forEach((n, j) => {
          const rnd = mulberry32(hashStr(n.id + "2d"));
          const baseR = pr === "P0" && arr.length === 1 ? 0 : RING[pr];
          const a = golden * j + (hashStr(n.id) % 10) * 0.12;
          pos.set(n.id, {
            x: c.x + Math.cos(a) * (baseR + rnd() * 22 - 11),
            y: c.y + Math.sin(a) * (baseR + rnd() * 22 - 11) * 0.92,
          });
        });
      });
    });
    return pos;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = { tx: 0, ty: 0, k: 1, targetTx: null, targetTy: null, drag: null, moved: 0, hoverLocal: null, lastCenter: null, override: new Map() };
    let W = 0, H = 0, dpr = 1, raf;

    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      if (st.tx === 0 && st.ty === 0) { st.tx = W / 2; st.ty = H / 2; st.k = Math.min(W / 1500, H / 950); }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(canvas);

    const P = (id) => st.override.get(id) || layout.get(id);
    const NODE_R = { P0: 13, P1: 9, P2: 6.5, P3: 5 };
    const hitTest = (mx, my) => {
      const wx = (mx - st.tx) / st.k, wy = (my - st.ty) / st.k;
      let best = null, bestD = 1e9;
      for (const n of nodes) {
        const p = P(n.id); if (!p) continue;
        const d = Math.hypot(p.x - wx, p.y - wy);
        const r = Math.max(NODE_R[n.priority] + 4, 11 / st.k);
        if (d <= r && d < bestD) { best = n.id; bestD = d; }
      }
      return best;
    };

    const onDown = (ev) => {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const id = hitTest(mx, my);
      st.drag = id ? { type: "node", id } : { type: "pan" };
      st.moved = 0; st.last = { x: mx, y: my };
      st.targetTx = null; st.targetTy = null; // 手动操作停止自动居中
    };
    const onMove = (ev) => {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (st.drag && (ev.buttons & 1)) {
        const dx = mx - st.last.x, dy = my - st.last.y;
        st.moved += Math.abs(dx) + Math.abs(dy);
        if (st.drag.type === "pan") { st.tx += dx; st.ty += dy; }
        else { const p = P(st.drag.id); st.override.set(st.drag.id, { x: p.x + dx / st.k, y: p.y + dy / st.k }); }
        st.last = { x: mx, y: my };
        if (st.moved > 4 && st.hoverLocal) { st.hoverLocal = null; onHover(null); }
        return;
      }
      const id = hitTest(mx, my);
      if (id !== st.hoverLocal) { st.hoverLocal = id; onHover(id, ev.clientX, ev.clientY); }
      else if (id) onHover(id, ev.clientX, ev.clientY);
      canvas.style.cursor = id ? "pointer" : "grab";
    };
    const onUp = () => {
      if (st.drag && st.moved <= 4) {
        if (st.drag.type === "node") onSelect(st.drag.id);
        else onClear();
      }
      st.drag = null;
    };
    const onWheel2 = (ev) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const k2 = Math.min(3, Math.max(0.25, st.k * Math.exp(-ev.deltaY * 0.0012)));
      st.tx = mx - ((mx - st.tx) / st.k) * k2;
      st.ty = my - ((my - st.ty) / st.k) * k2;
      st.k = k2;
    };
    const onLeave2 = () => { st.hoverLocal = null; onHover(null); };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel2, { passive: false });
    canvas.addEventListener("pointerleave", onLeave2);

    const hexPath = (x, y, r) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const p = propsRef.current;
      const tt = t / 1000;

      /* 选中/背离 → 自动居中 (与3D聚焦语义同步) */
      const centerId = p.selectedId || (p.divergence ? p.divergence.relatedNodeIds[0] : null);
      if (centerId !== st.lastCenter) {
        st.lastCenter = centerId;
        const cp = centerId ? P(centerId) : null;
        if (cp) { st.targetTx = W / 2 - cp.x * st.k; st.targetTy = H / 2 - cp.y * st.k; }
      }
      if (st.targetTx != null) {
        st.tx += (st.targetTx - st.tx) * 0.08; st.ty += (st.targetTy - st.ty) * 0.08;
        if (Math.abs(st.targetTx - st.tx) + Math.abs(st.targetTy - st.ty) < 0.5) { st.targetTx = null; st.targetTy = null; }
      }

      /* 高亮上下文 (与3D同一套规则) */
      let brightNodes = null, brightEdges = null;
      if (p.focusDivId && p.divergence) {
        brightNodes = new Set(p.divergence.relatedNodeIds);
        brightEdges = new Set(p.divergence.relatedEdgeIds);
      } else if (p.focusPathId) {
        const pa = paths.find((x) => x.id === p.focusPathId);
        if (pa) { brightNodes = new Set(pa.nodeIds); brightEdges = new Set(pathEdgeIds[pa.id] || []); }
      } else if (p.hoverId) {
        brightNodes = new Set([p.hoverId, ...(adjacency.adj[p.hoverId] || [])]);
        brightEdges = new Set(adjacency.edgesOf[p.hoverId] || []);
      } else if (p.selectedId) {
        const l1 = adjacency.adj[p.selectedId] || new Set();
        brightNodes = new Set([p.selectedId, ...l1]);
        brightEdges = new Set(adjacency.edgesOf[p.selectedId] || []);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(st.tx, st.ty); ctx.scale(st.k, st.k);

      /* 边 */
      edges.forEach((e) => {
        const a = P(e.source), b = P(e.target); if (!a || !b) return;
        const stl = EDGE_STYLE[e.status];
        let op = stl.opacity * 1.15, color = stl.color;
        const inB = brightEdges ? brightEdges.has(e.id) : null;
        if (brightEdges) {
          if (inB) { op = Math.max(op, e.status === "INACTIVE" ? 0.55 : 0.95); if (e.status === "INACTIVE") color = "#cfe2ff"; }
          else op *= 0.07;
        }
        if (!p.visibleSet.has(e.source) || !p.visibleSet.has(e.target)) op = 0.015;
        if (p.searchSet && !(p.searchSet.has(e.source) && p.searchSet.has(e.target))) op *= 0.2;
        if (op < 0.015) return;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = color; ctx.globalAlpha = Math.min(1, op);
        ctx.lineWidth = (inB ? 1.6 : 1) / st.k;
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx - dy / L * L * 0.1, my + dx / L * L * 0.1, b.x, b.y);
        ctx.stroke();
      });

      /* 节点 */
      nodes.forEach((n) => {
        const pos = P(n.id); if (!pos) return;
        const visible = p.visibleSet.has(n.id);
        const searchHit = p.searchSet ? p.searchSet.has(n.id) : null;
        const inB = brightNodes ? brightNodes.has(n.id) : null;
        const isHover = p.hoverId === n.id, isSel = p.selectedId === n.id;
        let r = NODE_R[n.priority], op = n.status === "NORMAL" ? 0.72 : 0.95;
        if (isHover || isSel) r *= 1.35;
        if (brightNodes && !inB) op *= 0.12;
        if (p.searchSet) op = searchHit ? 1 : op * 0.15;
        if (n.quality === "stale") op *= 0.45;
        if (!visible) op = 0.04;
        const col = CATS[n.category].color;
        ctx.globalAlpha = Math.min(1, op);
        if (REGIME_IDS.has(n.id)) {
          ctx.strokeStyle = col; ctx.lineWidth = 1.6 / st.k; hexPath(pos.x, pos.y, r + 4); ctx.stroke();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pos.x, pos.y, r * 0.62, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2); ctx.fill();
        }
        if (n.status !== "NORMAL" && op > 0.1) {
          const ringCol = STATUS[n.status].color;
          let ringR = r + 3.5, ringOp = 0.8;
          if (n.status === "DIVERGENCE") { ringR = r + 3.5 + 1.5 * (0.5 + 0.5 * Math.sin(tt * 1.6)); }
          if (n.status === "INVALIDATED") ringOp = 0.5 + 0.35 * Math.sin(tt * 2);
          ctx.globalAlpha = Math.min(1, op * ringOp);
          ctx.strokeStyle = ringCol; ctx.lineWidth = 1.4 / st.k;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, ringR, 0, Math.PI * 2); ctx.stroke();
        }
        if (isSel) {
          ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2 / st.k;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2); ctx.stroke();
        }
      });

      /* 标签: 主节点+全部一阶邻居 / 默认仅P0 */
      const drawLabel = (n, pos, main) => {
        const name = !main && (n.priority === "P2" || n.priority === "P3") && n.name.length > 8 ? n.name.slice(0, 7) + "…" : n.name;
        const fs = (main ? 12.5 : 11) / st.k;
        ctx.font = `${main ? 600 : 400} ${fs}px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif`;
        const tw = ctx.measureText(name).width;
        const lx = pos.x - tw / 2, ly = pos.y - NODE_R[n.priority] - 9 / st.k;
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = "rgba(8,12,20,0.88)";
        ctx.fillRect(lx - 5 / st.k, ly - fs, tw + 10 / st.k, fs + 7 / st.k);
        ctx.fillStyle = CATS[n.category].color;
        ctx.fillRect(lx - 5 / st.k, ly - fs, 2 / st.k, fs + 7 / st.k);
        ctx.globalAlpha = 1;
        ctx.fillStyle = main ? "#eef4fb" : "#c8d4e2";
        ctx.fillText(name, lx, ly);
      };
      const mainId = p.hoverId || p.selectedId;
      if (brightNodes) {
        let i = 0;
        for (const id of brightNodes) {
          if (i++ > 30) break;
          const n = nodes.find((x) => x.id === id); const pos = n && P(id);
          if (n && pos && p.visibleSet.has(id)) drawLabel(n, pos, id === mainId || (p.divergence && id === p.divergence.relatedNodeIds[0]));
        }
      } else if (st.k >= 0.55) {
        nodes.forEach((n) => {
          if (n.priority !== "P0") return;
          const pos = P(n.id);
          if (pos && p.visibleSet.has(n.id) && (!p.searchSet || p.searchSet.has(n.id))) drawLabel(n, pos, false);
        });
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel2);
      canvas.removeEventListener("pointerleave", onLeave2);
    };
  }, [nodes, edges, layout, adjacency, pathEdgeIds, paths, onHover, onSelect, onClear]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: "block" }} />;
}

/* ============================================================
   主组件
   ============================================================ */
export default function MacroTopologyTerminal({ live = null }) {
  /* ---------- 数据源: 真实数据优先, 内置模拟数据回退 ---------- */
  const isLive = !!live;
  const PATHS = live?.paths?.length ? live.paths : MOCK_PATHS;
  const DIVERGENCES = live?.divergences ?? MOCK_DIVERGENCES;
  const STATE = live?.marketState ?? MARKET_STATE;

  /* ---------- 派生数据 ---------- */
  const nodes = useMemo(() => {
    const raw = live?.nodes?.length ? live.nodes : RAW_NODES;
    return raw.map((n) => ({ ...n, history: n.history?.length ? n.history : genHistory(n) }));
  }, [live]);
  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const edges = useMemo(() => (live?.edges?.length ? live.edges : RAW_EDGES), [live]);
  const edgeById = useMemo(() => Object.fromEntries(edges.map((e) => [e.id, e])), [edges]);
  const positions = useMemo(() => computePositions(nodes), [nodes]);

  const adjacency = useMemo(() => {
    const adj = {}; const edgesOf = {};
    nodes.forEach((n) => { adj[n.id] = new Set(); edgesOf[n.id] = new Set(); });
    edges.forEach((e) => {
      adj[e.source]?.add(e.target); adj[e.target]?.add(e.source);
      edgesOf[e.source]?.add(e.id); edgesOf[e.target]?.add(e.id);
    });
    return { adj, edgesOf };
  }, [nodes, edges]);

  const pathEdgeIds = useMemo(() => {
    const m = {};
    PATHS.forEach((p) => {
      const ids = [];
      for (let i = 0; i < p.nodeIds.length - 1; i++) {
        const a = p.nodeIds[i], b = p.nodeIds[i + 1];
        const e = edges.find((x) => (x.source === a && x.target === b) || (x.source === b && x.target === a));
        if (e) ids.push(e.id);
      }
      m[p.id] = ids;
    });
    return m;
  }, [edges]);

  /* ---------- UI 状态 ---------- */
  const [hoverId, setHoverId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [focusDivId, setFocusDivId] = useState(null);
  const [focusPathId, setFocusPathId] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [timeWindow, setTimeWindow] = useState("5D");
  const [autoRotate, setAutoRotate] = useState(true);
  const [filterCats, setFilterCats] = useState(() => new Set(Object.keys(CATS)));
  const [filterStatus, setFilterStatus] = useState(() => new Set(Object.keys(STATUS)));
  const [filterPri, setFilterPri] = useState(() => new Set(PRIORITIES));
  const [search, setSearch] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("Global Map");
  const [viewMode, setViewMode] = useState("3D"); // "3D" | "2D"
  const [dataNoticeOpen, setDataNoticeOpen] = useState(false); // 数据状态声明面板
  const [webglError, setWebglError] = useState(false);

  const mountRef = useRef(null);
  const rootRef = useRef(null);
  const overlayRef = useRef(null); // 3D屏幕空间标签层
  const sceneRef = useRef(null); // { nodeObjs, edgeObjs, group, camera, ... }
  const uiRef = useRef({});

  const visibleSet = useMemo(() => {
    const s = new Set();
    nodes.forEach((n) => {
      if (filterCats.has(n.category) && filterStatus.has(n.status) && filterPri.has(n.priority)) s.add(n.id);
    });
    return s;
  }, [nodes, filterCats, filterStatus, filterPri]);

  const searchSet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const s = new Set();
    nodes.forEach((n) => { if (n.name.toLowerCase().includes(q) || n.id.includes(q)) s.add(n.id); });
    return s;
  }, [search, nodes]);

  /* 同步状态到 rAF 可读的 ref */
  useEffect(() => {
    uiRef.current = {
      hoverId, selectedId, focusDivId, focusPathId, autoRotate, visibleSet, searchSet,
      adjacency, pathEdgeIds, viewMode,
      divergence: focusDivId ? DIVERGENCES.find((d) => d.id === focusDivId) : null,
    };
  }, [hoverId, selectedId, focusDivId, focusPathId, autoRotate, visibleSet, searchSet, adjacency, pathEdgeIds, viewMode]);

  /* 数据状态清单: 优先读管道写入的 market_state.data_status, 回退用节点quality字段推断 */
  const dataStatus = useMemo(() => {
    if (!isLive) return null;
    const ds = STATE.data_status;
    const byQ = (q) => nodes.filter((n) => n.quality === q).map((n) => n.id);
    const stale = ds?.stale ?? byQ("stale");
    const manual = ds?.manual ?? byQ("manual");
    const proxy = ds?.proxy ?? byQ("derived");
    return {
      stale, manual, proxy,
      liveCount: ds?.liveCount ?? Math.max(0, nodes.length - stale.length - manual.length),
      totalCount: ds?.totalCount ?? nodes.length,
      sourceErrors: ds?.sourceErrors ?? null,
    };
  }, [isLive, STATE, nodes]);

  const focusOnNode = useCallback((id) => {
    const sc = sceneRef.current; if (!sc) return;
    const p = positions[id]; if (!p) return;
    const q = new THREE.Quaternion().setFromUnitVectors(p.clone().normalize(), new THREE.Vector3(0, 0, 1));
    sc.focusQuat = q;
    sc.targetZ = 19;
  }, [positions]);

  const selectNode = useCallback((id) => {
    setFocusDivId(null); setFocusPathId(null);
    setSelectedId(id);
    if (id) focusOnNode(id);
  }, [focusOnNode]);

  const focusDivergence = useCallback((d) => {
    setSelectedId(null); setFocusPathId(null);
    setFocusDivId(d.id);
    focusOnNode(d.relatedNodeIds[0]);
  }, [focusOnNode]);

  const exitFocus = useCallback(() => {
    setFocusDivId(null); setSelectedId(null); setFocusPathId(null);
    const sc = sceneRef.current; if (sc) { sc.focusQuat = null; sc.targetZ = 26; }
  }, []);

  /* ---------- Three.js 场景 ---------- */
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) { setWebglError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 节点扩容后限制DPR控制填充率
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 300);
    camera.position.set(0, 0, 26);

    /* 背景星点 */
    {
      const g = new THREE.BufferGeometry();
      const cnt = 700; const arr = new Float32Array(cnt * 3);
      const rnd = mulberry32(1234);
      for (let i = 0; i < cnt; i++) {
        const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(55 + rnd() * 50);
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      }
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const m = new THREE.PointsMaterial({ color: 0x5a6a82, size: 0.18, transparent: true, opacity: 0.35, sizeAttenuation: true });
      scene.add(new THREE.Points(g, m));
    }

    const group = new THREE.Group();
    scene.add(group);

    const circleTex = makeCircleTexture();
    const glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();
    const regimeTex = makeRegimeTexture();   // Regime节点专属外观 (六边形+双环)

    /* 节点 */
    const nodeObjs = {};
    const coreSprites = [];
    nodes.forEach((n, idx) => {
      const p = positions[n.id];
      const color = new THREE.Color(CATS[n.category].color);
      const baseScale = n.priority === "P0" ? 0.78 : n.priority === "P1" ? 0.56 : n.priority === "P2" ? 0.44 : 0.36;

      const isRegime = REGIME_IDS.has(n.id);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: isRegime ? regimeTex : circleTex, color, transparent: true, opacity: 0.0, depthWrite: false }));
      core.position.copy(p); core.scale.setScalar(0.001);
      core.userData = { nodeId: n.id };
      group.add(core); coreSprites.push(core);

      // 性能: 仅 P0/P1 或异常状态节点拥有独立 glow 层, 普通 P2/P3 省略 (节点扩容后减少约45%的Sprite)
      let glow = null;
      if (n.priority === "P0" || n.priority === "P1" || n.status !== "NORMAL" || isRegime) {
        glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color.clone(), transparent: true, opacity: 0, depthWrite: false }));
        glow.position.copy(p); glow.scale.setScalar(baseScale * 2.6); glow.raycast = () => {};
        group.add(glow);
      }

      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color("#ffffff"), transparent: true, opacity: 0, depthWrite: false }));
      ring.position.copy(p); ring.scale.setScalar(baseScale * 1.9); ring.raycast = () => {};
      group.add(ring);

      let label = null, labelAspect = 1;
      if (n.priority === "P0") {
        const { tex, aspect } = makeLabelTexture(n.name, "#aebccd");
        labelAspect = aspect;
        label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
        label.position.copy(p.clone().add(new THREE.Vector3(0, -baseScale * 1.5, 0)));
        label.scale.set(0.72 * aspect, 0.72, 1);
        label.raycast = () => {};
        group.add(label);
      }
      nodeObjs[n.id] = { node: n, core, glow, ring, label, labelAspect, baseScale, idx, curScale: 0.001, curOp: 0, curGlow: 0, curRing: 0, curLabel: 0 };
    });

    /* 边(弧线) */
    const edgeObjs = {};
    edges.forEach((e) => {
      const a = positions[e.source], b = positions[e.target];
      if (!a || !b) return;
      let mid = a.clone().add(b).multiplyScalar(0.5);
      if (mid.length() < 0.5) mid = a.clone().cross(b).normalize().multiplyScalar(SPHERE_R * 0.6);
      const dist = a.distanceTo(b);
      mid.setLength(Math.max(mid.length(), 0.1)).normalize().multiplyScalar(SPHERE_R * 1.0 + dist * 0.16);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(22));
      const st = EDGE_STYLE[e.status];
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(st.color), transparent: true, opacity: 0, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      group.add(line);
      edgeObjs[e.id] = { edge: e, line, curOp: 0 };
    });

    /* 交互 */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false, downPos = null, lastPos = null, moved = 0;
    let hoverLocal = null;
    let lastRay = { x: -1e4, y: -1e4 };
    /* 旋转暂停集中管理: 进入容器/悬浮/选中/背离聚焦/拖拽/缩放/2D视图 任一成立即暂停 */
    const rot = { inside: false, dragging: false, zoomUntil: 0 };
    const onEnterGraph = () => { rot.inside = true; };
    const onLeaveGraph = () => { rot.inside = false; };

    const onPointerDown = (ev) => {
      downPos = { x: ev.clientX, y: ev.clientY };
      lastPos = { ...downPos }; moved = 0; dragging = false;
    };
    const onPointerMove = (ev) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (downPos && (ev.buttons & 1)) {
        const dx = ev.clientX - lastPos.x, dy = ev.clientY - lastPos.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) {
          dragging = true; rot.dragging = true;
          sceneRef.current.focusQuat = null; // 拖拽取消聚焦
          group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * 0.005);
          group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), dy * 0.005);
        }
        lastPos = { x: ev.clientX, y: ev.clientY };
        if (dragging) { if (hoverLocal) { hoverLocal = null; setHoverId(null); } return; }
      }
      // 性能: 指针累计移动≥3px才执行Raycast (节点扩容后命中测试成本上升)
      if (Math.abs(ev.clientX - lastRay.x) + Math.abs(ev.clientY - lastRay.y) >= 3) {
        lastRay = { x: ev.clientX, y: ev.clientY };
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(coreSprites, false);
        const id = hits.length ? hits[0].object.userData.nodeId : null;
        if (id !== hoverLocal) { hoverLocal = id; setHoverId(id); }
        renderer.domElement.style.cursor = id ? "pointer" : "grab";
      }
      if (hoverLocal) setMouse({ x: ev.clientX, y: ev.clientY }); // 仅tooltip可见时更新坐标, 避免每次移动触发React渲染
    };
    const onPointerUp = (ev) => {
      if (!dragging && downPos) {
        if (hoverLocal) selectNodeRef.current(hoverLocal);
        else exitFocusRef.current();
      }
      downPos = null; dragging = false; rot.dragging = false;
    };
    const onWheel = (ev) => {
      ev.preventDefault();
      rot.zoomUntil = Date.now() + 600; // 缩放期间暂停旋转
      const sc = sceneRef.current;
      sc.targetZ = THREE.MathUtils.clamp(sc.targetZ + ev.deltaY * 0.02, 13, 44);
    };
    const onLeave = () => { hoverLocal = null; setHoverId(null); };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onLeave);
    mount.addEventListener("pointerenter", onEnterGraph);
    mount.addEventListener("pointerleave", onLeaveGraph);

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return; // 2D视图下容器隐藏时跳过
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    sceneRef.current = { renderer, scene, camera, group, nodeObjs, edgeObjs, focusQuat: null, targetZ: 26, lastPauseT: -10 };

    /* ---- 屏幕空间DOM标签层: 悬浮/选中/背离/路径时显示主节点+全部一阶邻居 ---- */
    const overlayEl = overlayRef.current;
    const labelPool = [];
    if (overlayEl) {
      for (let i = 0; i < 30; i++) {
        const d = document.createElement("div");
        d.style.cssText = "position:absolute;left:0;top:0;display:none;white-space:nowrap;border-radius:3px;padding:1px 6px;background:rgba(8,12,20,0.88);border:1px solid rgba(70,90,120,0.35);color:#c8d4e2;font:11px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;will-change:transform;";
        overlayEl.appendChild(d);
        labelPool.push(d);
      }
    }
    const PRI_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const tmpV = new THREE.Vector3();
    const updateOverlay = (ui) => {
      if (!overlayEl) return;
      let ids = null, mainId = null;
      if (ui.hoverId && nodeObjs[ui.hoverId]) {
        mainId = ui.hoverId; ids = [ui.hoverId, ...(ui.adjacency.adj[ui.hoverId] || [])];
      } else if (ui.selectedId && nodeObjs[ui.selectedId]) {
        mainId = ui.selectedId; ids = [ui.selectedId, ...(ui.adjacency.adj[ui.selectedId] || [])];
      } else if (ui.focusDivId && ui.divergence) {
        mainId = ui.divergence.relatedNodeIds[0]; ids = [...ui.divergence.relatedNodeIds];
      } else if (ui.focusPathId) {
        const p = PATHS.find((x) => x.id === ui.focusPathId);
        if (p) { mainId = p.nodeIds[0]; ids = [...p.nodeIds]; }
      }
      if (!ids) { labelPool.forEach((d) => { if (d.style.display !== "none") d.style.display = "none"; }); return; }

      const w = mount.clientWidth, h = mount.clientHeight;
      const mainPos = nodeObjs[mainId] && nodeObjs[mainId].core.getWorldPosition(tmpV).clone();
      const panelOpen = !!(ui.selectedId || ui.focusDivId);
      const entries = [];
      for (const id of ids) {
        const o = nodeObjs[id]; if (!o || !ui.visibleSet.has(id)) continue;
        o.core.getWorldPosition(tmpV);
        const dist = mainPos ? tmpV.distanceTo(mainPos) : 0;
        tmpV.project(camera);
        if (tmpV.z > 1) continue;
        let x = (tmpV.x * 0.5 + 0.5) * w;
        let y = (-tmpV.y * 0.5 + 0.5) * h - 14;
        const main = id === mainId;
        const n = o.node;
        const name = !main && (n.priority === "P2" || n.priority === "P3") && n.name.length > 8 ? n.name.slice(0, 7) + "…" : n.name;
        const ew = 14 + name.length * (main ? 13 : 11.5);
        const maxX = (panelOpen ? w - 368 : w - 20) - ew / 2;
        x = Math.min(Math.max(x, 10 + ew / 2), Math.max(60, maxX));
        y = Math.min(Math.max(y, 56), h - 46);
        entries.push({ id, name, x, y, ew, main, pri: PRI_RANK[n.priority], dist, color: CATS[n.category].color });
      }
      entries.sort((a, b) => (a.main !== b.main ? (a.main ? -1 : 1) : a.pri - b.pri || a.dist - b.dist));
      /* 轻量碰撞: 依次尝试上下偏移, 用尽后仍显示 (不整体隐藏) */
      const placed = [];
      const offsets = [0, -18, 18, -36, 36, -54, 54];
      for (const e of entries.slice(0, labelPool.length)) {
        let fy = e.y;
        for (const off of offsets) {
          const ty = e.y + off;
          const clash = placed.some((r) => Math.abs(r.y - ty) < 17 && Math.abs(r.x - e.x) < (r.ew + e.ew) / 2);
          if (!clash) { fy = ty; break; }
        }
        placed.push({ x: e.x, y: fy, ew: e.ew });
        e.fy = Math.min(Math.max(fy, 56), h - 46);
      }
      labelPool.forEach((d, i) => {
        const e = entries[i];
        if (!e) { if (d.style.display !== "none") d.style.display = "none"; return; }
        if (d._id !== e.id || d._main !== e.main) {
          d._id = e.id; d._main = e.main;
          d.textContent = e.name;
          d.style.borderLeft = `2px solid ${e.color}`;
          d.style.fontSize = e.main ? "12.5px" : "11px";
          d.style.fontWeight = e.main ? "600" : "400";
          d.style.color = e.main ? "#eef4fb" : "#c8d4e2";
          d.style.zIndex = e.main ? "12" : "11";
        }
        d.style.transform = `translate(${e.x.toFixed(1)}px, ${e.fy.toFixed(1)}px) translate(-50%, -100%)`;
        if (d.style.display !== "block") d.style.display = "block";
      });
    };

    /* 渲染循环 */
    const clock = new THREE.Clock();
    let raf;
    const tmpColor = new THREE.Color();
    const activeBoost = new THREE.Color("#cfe2ff");

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const sc = sceneRef.current;
      const ui = uiRef.current;
      const t = clock.getElapsedTime();
      if (ui.viewMode !== "3D") { sc.lastPauseT = t; return; } // 2D视图下挂起3D渲染(保留场景与相机)
      const intro = Math.min(1, t / 1.8);

      /* 相机 / 旋转: 单一门控 shouldPause → canAutoRotate, 离开后延迟1秒恢复 */
      camera.position.z += (sc.targetZ - camera.position.z) * 0.07;
      const shouldPause = rot.inside || rot.dragging || Date.now() < rot.zoomUntil ||
        !!ui.hoverId || !!ui.selectedId || !!ui.focusDivId || !!ui.focusPathId;
      if (shouldPause) sc.lastPauseT = t;
      if (sc.focusQuat) {
        group.quaternion.slerp(sc.focusQuat, 0.06);
      } else if (ui.autoRotate && !shouldPause && t - sc.lastPauseT > 1.0) {
        group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), 0.0009);
      }

      /* 高亮上下文 */
      let brightNodes = null, brightEdges = null;
      if (ui.focusDivId && ui.divergence) {
        brightNodes = new Set(ui.divergence.relatedNodeIds);
        brightEdges = new Set(ui.divergence.relatedEdgeIds);
      } else if (ui.focusPathId) {
        const p = PATHS.find((x) => x.id === ui.focusPathId);
        if (p) { brightNodes = new Set(p.nodeIds); brightEdges = new Set(ui.pathEdgeIds[p.id] || []); }
      } else if (ui.hoverId) {
        brightNodes = new Set([ui.hoverId, ...(ui.adjacency.adj[ui.hoverId] || [])]);
        brightEdges = new Set(ui.adjacency.edgesOf[ui.hoverId] || []);
      } else if (ui.selectedId) {
        const l1 = ui.adjacency.adj[ui.selectedId] || new Set();
        brightNodes = new Set([ui.selectedId, ...l1]);
        brightEdges = new Set(ui.adjacency.edgesOf[ui.selectedId] || []);
        l1.forEach((m) => {
          (ui.adjacency.adj[m] || []).forEach((mm) => brightNodes.add(mm));
          (ui.adjacency.edgesOf[m] || []).forEach((ee) => brightEdges.add(ee));
        });
      }

      /* 节点 */
      Object.values(sc.nodeObjs).forEach((o) => {
        const n = o.node;
        const stagger = Math.min(1, Math.max(0, intro * 1.5 - (o.idx / nodes.length) * 0.5));
        const ease = 1 - Math.pow(1 - stagger, 3);

        const visible = ui.visibleSet.has(n.id);
        const searchHit = ui.searchSet ? ui.searchSet.has(n.id) : null;
        const inBright = brightNodes ? brightNodes.has(n.id) : null;
        const isHover = ui.hoverId === n.id;
        const isSelected = ui.selectedId === n.id;

        let op = n.status === "NORMAL" ? 0.62 : 0.92;
        let scale = o.baseScale;
        let glowOp = n.status === "EXTREME" ? 0.55 : n.status === "DIVERGENCE" ? 0.35 : n.priority === "P0" ? 0.16 : 0.07;
        let ringOp = 0; let ringScale = o.baseScale * 1.9; let ringColor = null;

        if (n.status === "ELEVATED") { ringOp = 0.75; ringColor = STATUS.ELEVATED.color; }
        if (n.status === "EXTREME") { ringOp = 0.5; ringColor = STATUS.EXTREME.color; }
        if (n.status === "DIVERGENCE") {
          ringColor = STATUS.DIVERGENCE.color;
          ringOp = 0.55 + 0.3 * Math.sin(t * 1.6 + o.idx);
          ringScale = o.baseScale * (1.9 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6 + o.idx)));
        }
        if (n.status === "INVALIDATED") { ringColor = STATUS.INVALIDATED.color; ringOp = 0.45 + 0.35 * Math.sin(t * 2.0); }
        if (n.priority === "P0" && (n.status === "EXTREME" || n.status === "DIVERGENCE")) {
          scale *= 1 + 0.06 * Math.sin(t * 1.3 + o.idx); // 呼吸
        }
        if (isHover) { scale *= 1.3; op = 1; glowOp = Math.max(glowOp, 0.45); }
        if (isSelected) { scale *= 1.22; op = 1; glowOp = Math.max(glowOp, 0.5); }

        if (brightNodes && !inBright) { op *= 0.14; glowOp *= 0.1; ringOp *= 0.12; }
        if (ui.searchSet) { if (searchHit) { op = 1; glowOp = Math.max(glowOp, 0.4); } else { op *= 0.18; glowOp *= 0.1; ringOp *= 0.15; } }
        if (n.quality === "stale") { op *= 0.45; glowOp *= 0.4; } // 未取到数据的节点压暗
        if (!visible) { op = 0.04; glowOp = 0; ringOp = 0; }

        const overlayOn = !!(ui.hoverId || ui.selectedId || ui.focusDivId || ui.focusPathId);
        const labelTarget = overlayOn ? 0 : ((n.priority === "P0" && !brightNodes && visible && (!ui.searchSet || searchHit)) ? 0.85 : 0.0);

        o.curScale += (scale * ease - o.curScale) * 0.14;
        o.curOp += (op * ease - o.curOp) * 0.12;
        o.curGlow += (glowOp * ease - o.curGlow) * 0.1;
        o.curRing += (ringOp * ease - o.curRing) * 0.12;
        o.curLabel += (labelTarget * ease - o.curLabel) * 0.1;

        o.core.scale.setScalar(Math.max(0.001, o.curScale));
        o.core.material.opacity = o.curOp;
        if (o.glow) {
          o.glow.scale.setScalar(Math.max(0.001, o.curScale * 2.9));
          o.glow.material.opacity = o.curGlow;
          if (n.status === "EXTREME") o.glow.material.color.set(STATUS.EXTREME.color);
          else if (n.status === "DIVERGENCE") o.glow.material.color.set(STATUS.DIVERGENCE.color);
          else o.glow.material.color.set(CATS[n.category].color);
        }
        if (REGIME_IDS.has(n.id)) o.core.material.rotation = t * 0.15; // regime六边形缓慢自旋
        o.ring.scale.setScalar(ringScale);
        o.ring.material.opacity = o.curRing;
        if (ringColor) o.ring.material.color.set(ringColor);
        if (o.label) o.label.material.opacity = o.curLabel;
      });

      /* 边 */
      Object.values(sc.edgeObjs).forEach((o) => {
        const e = o.edge;
        const st = EDGE_STYLE[e.status];
        let op = st.opacity;
        tmpColor.set(st.color);
        if (e.status === "ACTIVE") op = st.opacity + 0.1 * Math.sin(t * 1.2 + hashStr(e.id) % 10);
        const inBright = brightEdges ? brightEdges.has(e.id) : null;
        if (brightEdges) {
          if (inBright) { op = Math.max(op, e.status === "INACTIVE" ? 0.5 : 0.9); if (e.status === "INACTIVE") tmpColor.copy(activeBoost); }
          else op *= 0.1;
        }
        if (!uiRef.current.visibleSet.has(e.source) || !uiRef.current.visibleSet.has(e.target)) op = 0.02;
        if (uiRef.current.searchSet && !(uiRef.current.searchSet.has(e.source) && uiRef.current.searchSet.has(e.target))) op *= 0.25;
        op *= intro;
        o.curOp += (op - o.curOp) * 0.12;
        o.line.material.opacity = o.curOp;
        o.line.material.color.copy(tmpColor);
      });

      updateOverlay(ui);
      renderer.render(scene, camera);
    };
    animate();

    // 性能: 页面隐藏时暂停渲染循环
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else { clock.getDelta(); raf = requestAnimationFrame(animate); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      mount.removeEventListener("pointerenter", onEnterGraph);
      mount.removeEventListener("pointerleave", onLeaveGraph);
      if (overlayEl) labelPool.forEach((d) => overlayEl.removeChild(d));
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      Object.values(sceneRef.current?.nodeObjs || {}).forEach((o) => {
        o.core.material.dispose(); if (o.glow) o.glow.material.dispose(); o.ring.material.dispose();
        if (o.label) { o.label.material.map?.dispose(); o.label.material.dispose(); }
      });
      Object.values(sceneRef.current?.edgeObjs || {}).forEach((o) => { o.line.geometry.dispose(); o.line.material.dispose(); });
      circleTex.dispose(); glowTex.dispose(); ringTex.dispose(); regimeTex.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 让事件回调拿到最新函数 */
  const selectNodeRef = useRef(selectNode); selectNodeRef.current = selectNode;
  const exitFocusRef = useRef(exitFocus); exitFocusRef.current = exitFocus;

  /* ---------- 详情面板内容 ---------- */
  const selectedNode = selectedId ? nodeById[selectedId] : null;
  const focusDiv = focusDivId ? DIVERGENCES.find((d) => d.id === focusDivId) : null;
  const panelOpen = !!(selectedNode || focusDiv);

  const upstream = selectedNode ? edges.filter((e) => e.target === selectedNode.id).map((e) => ({ e, n: nodeById[e.source] })) : [];
  const downstream = selectedNode ? edges.filter((e) => e.source === selectedNode.id).map((e) => ({ e, n: nodeById[e.target] })) : [];
  const relatedDivs = selectedNode ? DIVERGENCES.filter((d) => d.relatedNodeIds.includes(selectedNode.id)) : [];
  const relatedPaths = selectedNode ? PATHS.filter((p) => p.nodeIds.includes(selectedNode.id)) : [];

  const hoverNode = hoverId ? nodeById[hoverId] : null;
  const highRiskCount = nodes.filter((n) => n.status === "EXTREME" || n.status === "INVALIDATED").length;
  const divNodeCount = nodes.filter((n) => n.status === "DIVERGENCE").length;
  const dominantPath = PATHS.find((p) => p.id === STATE.dominantPathId);

  const winSlice = { "1D": 12, "5D": 20, "20D": 40, "60D": 60 }[timeWindow];
  const chartData = selectedNode ? selectedNode.history.slice(60 - winSlice) : null;

  const toggleSet = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleCat = toggleSet(setFilterCats), toggleStatus = toggleSet(setFilterStatus), togglePri = toggleSet(setFilterPri);

  const onFullscreen = () => {
    const el = rootRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };
  const onSearchKey = (e) => {
    if (e.key === "Enter" && searchSet && searchSet.size) selectNode([...searchSet][0]);
    if (e.key === "Escape") setSearch("");
  };

  /* ============================ 渲染 ============================ */
  return (
    <div ref={rootRef} className="w-full h-screen relative overflow-hidden select-none"
      style={{ background: `radial-gradient(1200px 700px at 50% 42%, #0a101c 0%, ${BG} 62%)`, color: TXT, fontFamily: "-apple-system,'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif" }}>

      {/* 3D 画布 */}
      <div ref={mountRef} className="absolute inset-0" style={{ visibility: viewMode === "3D" ? "visible" : "hidden" }} />
      <div ref={overlayRef} className="absolute inset-0 z-10" style={{ pointerEvents: "none", overflow: "hidden", display: viewMode === "3D" ? undefined : "none" }} />
      {viewMode === "2D" && (
        <div className="absolute inset-0">
          <Topo2D nodes={nodes} edges={edges} adjacency={adjacency} pathEdgeIds={pathEdgeIds} paths={PATHS}
            hoverId={hoverId} selectedId={selectedId} focusDivId={focusDivId} focusPathId={focusPathId}
            divergence={focusDivId ? DIVERGENCES.find((d) => d.id === focusDivId) : null}
            visibleSet={visibleSet} searchSet={searchSet}
            onHover={(id, x, y) => { setHoverId(id); if (id != null && x != null) setMouse({ x, y }); }}
            onSelect={selectNode} onClear={exitFocus} />
        </div>
      )}
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-6 py-4 rounded border text-sm" style={{ background: PANEL, borderColor: PANEL_BORDER }}>
            当前环境不支持 WebGL,无法渲染 3D 拓扑。请更换浏览器或开启硬件加速。
          </div>
        </div>
      )}

      {/* ====== 顶部导航 ====== */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-12 border-b"
        style={{ background: "rgba(6,9,15,0.78)", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full" style={{ background: "#5b8fe0", boxShadow: "0 0 8px #5b8fe0" }} />
            <span className="tracking-widest text-sm font-semibold" style={{ fontFamily: MONO, color: "#dfe7f1" }}>MACRO&nbsp;TOPOLOGY</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {["Global Map", "Assets", "Drivers", "Divergences", "Scenarios", "Alerts"].map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="px-3 py-1 text-xs rounded transition-colors"
                style={{
                  color: activeTab === tab ? "#e8eef6" : TXT_DIM,
                  background: activeTab === tab ? "rgba(91,143,224,0.14)" : "transparent",
                  borderBottom: activeTab === tab ? "1px solid rgba(91,143,224,0.6)" : "1px solid transparent",
                }}>{tab}</button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded overflow-hidden border" style={{ borderColor: PANEL_BORDER }}>
            {["3D", "2D"].map((m) => (
              <button key={m} onClick={() => { setViewMode(m); setHoverId(null); }}
                className="px-2.5 py-1 text-xs" style={{ fontFamily: MONO, letterSpacing: 1, color: viewMode === m ? "#0a0e16" : TXT_DIM, background: viewMode === m ? "#9fb6d8" : "rgba(15,20,30,0.8)" }}>
                {m === "3D" ? "3D SPHERE" : "2D MAP"}
              </button>
            ))}
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey}
            placeholder="搜索变量 / Search"
            className="hidden sm:block w-44 px-2.5 py-1 text-xs rounded outline-none"
            style={{ background: "rgba(20,27,40,0.9)", border: `1px solid ${PANEL_BORDER}`, color: TXT, fontFamily: MONO }} />
          <div className="flex rounded overflow-hidden border" style={{ borderColor: PANEL_BORDER }}>
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setTimeWindow(w)}
                className="px-2 py-1 text-xs"
                style={{ fontFamily: MONO, color: timeWindow === w ? "#0a0e16" : TXT_DIM, background: timeWindow === w ? "#9fb6d8" : "rgba(15,20,30,0.8)" }}>
                {w}
              </button>
            ))}
          </div>
          <button onClick={() => setAutoRotate((v) => !v)} title="自动旋转"
            className="px-2 py-1 text-xs rounded border"
            style={{ borderColor: PANEL_BORDER, color: autoRotate ? "#9fc3ff" : TXT_DIM, background: "rgba(15,20,30,0.8)", fontFamily: MONO }}>
            ⟳ {autoRotate ? "ON" : "OFF"}
          </button>
          <button onClick={onFullscreen} title="全屏" className="px-2 py-1 text-xs rounded border"
            style={{ borderColor: PANEL_BORDER, color: TXT_DIM, background: "rgba(15,20,30,0.8)", fontFamily: MONO }}>⛶</button>
          <span className="hidden lg:block text-xs" style={{ color: TXT_DIM, fontFamily: MONO }}>{isLive ? `LIVE · ${(STATE.updatedAt || "").slice(0, 16).replace("T", " ")} UTC` : "SIMULATED DATA · For interface demonstration only"}</span>
        </div>
      </div>

      {/* ====== 左上:Current Market State ====== */}
      <div className="absolute z-20 left-4 top-16 w-80 rounded-md border p-4"
        style={{ background: PANEL, borderColor: PANEL_BORDER, backdropFilter: "blur(10px)" }}>
        <div className="text-xs tracking-widest mb-0.5" style={{ fontFamily: MONO, color: "#8fa9cc" }}>MACRO TOPOLOGY</div>
        <div className="text-sm font-medium mb-1" style={{ color: "#e6edf5" }}>Current Market State</div>
        <div className="text-xs mb-3" style={{ color: TXT_DIM }}>See the market as a connected system.</div>

        <div className="space-y-2.5 text-xs leading-relaxed">
          <div>
            <div style={{ color: TXT_DIM }}>最显著异动</div>
            <button className="text-left hover:underline" style={{ color: STATUS.EXTREME.color }}
              onClick={() => selectNode(STATE.topMover.nodeId)}>{STATE.topMover.text}</button>
          </div>
          <div>
            <div style={{ color: TXT_DIM }}>主导激活路径</div>
            <button className="text-left hover:underline" style={{ color: "#ffd9a0" }}
              onClick={() => { setSelectedId(null); setFocusDivId(null); setFocusPathId(PATHS[0]?.id ?? null); focusOnNode("us10y"); }}>
              {dominantPath?.label}
            </button>
          </div>
          <div className="flex gap-4 pt-1" style={{ fontFamily: MONO }}>
            <div><span style={{ color: STATUS.DIVERGENCE.color }}>{DIVERGENCES.length}</span><span style={{ color: TXT_DIM }}> 背离</span></div>
            <div><span style={{ color: STATUS.EXTREME.color }}>{highRiskCount}</span><span style={{ color: TXT_DIM }}> 高风险节点</span></div>
            <div><span style={{ color: STATUS.DIVERGENCE.color }}>{divNodeCount}</span><span style={{ color: TXT_DIM }}> 背离节点</span></div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span style={{ color: TXT_DIM }}>宏观状态</span>
            <span className="px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: MONO, color: "#0a0e16", background: STATUS.ELEVATED.color }}>{STATE.regime}</span>
          </div>
          <div className="pt-1 border-t" style={{ borderColor: PANEL_BORDER, color: "#9fb0c4" }}>{STATE.regimeNote}</div>
        </div>
      </div>

      {/* ====== 左侧过滤器 ====== */}
      <div className="absolute z-20 left-4 rounded-md border overflow-hidden"
        style={{ top: "21.5rem", width: leftOpen ? "20rem" : "8.5rem", background: PANEL, borderColor: PANEL_BORDER, backdropFilter: "blur(10px)", transition: "width .25s ease" }}>
        <button onClick={() => setLeftOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-xs"
          style={{ color: "#aebccd", fontFamily: MONO }}>
          <span>FILTERS</span><span>{leftOpen ? "−" : "+"}</span>
        </button>
        {leftOpen && (
          <div className="px-3 pb-3 space-y-3 text-xs">
            <div>
              <div className="mb-1.5" style={{ color: TXT_DIM }}>按模块</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CATS).map(([k, c]) => (
                  <button key={k} onClick={() => toggleCat(k)} className="px-2 py-0.5 rounded-full border flex items-center gap-1.5"
                    style={{ borderColor: filterCats.has(k) ? c.color : PANEL_BORDER, color: filterCats.has(k) ? "#dde6f0" : TXT_DIM, opacity: filterCats.has(k) ? 1 : 0.55, background: "rgba(12,17,26,0.7)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />{c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5" style={{ color: TXT_DIM }}>按状态</div>
              <div className="flex flex-wrap gap-1.5" style={{ fontFamily: MONO }}>
                {Object.entries(STATUS).map(([k, s]) => (
                  <button key={k} onClick={() => toggleStatus(k)} className="px-2 py-0.5 rounded border"
                    style={{ borderColor: filterStatus.has(k) ? s.color : PANEL_BORDER, color: filterStatus.has(k) ? s.color : TXT_DIM, opacity: filterStatus.has(k) ? 1 : 0.5, background: "rgba(12,17,26,0.7)", fontSize: 10 }}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5" style={{ color: TXT_DIM }}>按优先级</div>
              <div className="flex gap-1.5" style={{ fontFamily: MONO }}>
                {PRIORITIES.map((p) => (
                  <button key={p} onClick={() => togglePri(p)} className="px-2.5 py-0.5 rounded border"
                    style={{ borderColor: filterPri.has(p) ? "#7e93b3" : PANEL_BORDER, color: filterPri.has(p) ? "#dde6f0" : TXT_DIM, opacity: filterPri.has(p) ? 1 : 0.5, background: "rgba(12,17,26,0.7)" }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====== 右下:Divergence Monitor ====== */}
      <div className="absolute z-20 right-4 bottom-4 w-96 max-w-full rounded-md border"
        style={{ background: PANEL, borderColor: PANEL_BORDER, backdropFilter: "blur(10px)" }}>
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}>
          <div className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: "#e4b8df" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: STATUS.DIVERGENCE.color }} />
            DIVERGENCE&nbsp;MONITOR
          </div>
          {focusDivId && (
            <button onClick={exitFocus} className="text-xs px-2 py-0.5 rounded border"
              style={{ borderColor: PANEL_BORDER, color: TXT_DIM, fontFamily: MONO }}>退出聚焦 ✕</button>
          )}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {DIVERGENCES.map((d, i) => {
            const active = focusDivId === d.id;
            return (
              <button key={d.id} onClick={() => (active ? exitFocus() : focusDivergence(d))}
                className="w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors"
                style={{ borderColor: "rgba(120,140,170,0.08)", background: active ? "rgba(224,85,200,0.10)" : "transparent" }}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs" style={{ fontFamily: MONO, color: STATUS.DIVERGENCE.color }}>{String(i + 1).padStart(2, "0")}</span>
                  <div className="flex-1">
                    <div className="text-xs" style={{ color: active ? "#f0d6ee" : "#c9d3e0" }}>{d.title}</div>
                    <div className="flex gap-2 mt-1 text-xs" style={{ fontFamily: MONO, fontSize: 10 }}>
                      <span style={{ color: TXT_DIM }}>{d.window}</span>
                      <span style={{ color: d.strength === "HIGH" ? STATUS.EXTREME.color : d.strength === "MEDIUM" ? STATUS.ELEVATED.color : TXT_DIM }}>强度 {d.strength}</span>
                      <span style={{ color: d.invalidationRisk === "HIGH" ? STATUS.INVALIDATED.color : TXT_DIM }}>失效风险 {d.invalidationRisk}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ====== 悬浮卡片 ====== */}
      {/* ====== 数据状态声明面板 (辅助声明, 可关闭) ====== */}
      {dataNoticeOpen && dataStatus && (
        <div className="absolute z-30 left-4 bottom-12 w-[26rem] max-h-[24rem] overflow-auto rounded-md border p-4"
          style={{ background: PANEL, borderColor: PANEL_BORDER, backdropFilter: "blur(10px)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs tracking-widest" style={{ fontFamily: MONO, color: "#8fa9cc" }}>DATA STATUS · 数据源状态声明</div>
            <button onClick={() => setDataNoticeOpen(false)} className="text-xs px-1.5" style={{ color: TXT_DIM }}>✕</button>
          </div>
          <div className="text-xs mb-3" style={{ color: TXT_DIM }}>
            {dataStatus.totalCount} 个指标中 <span style={{ color: "#6fc28a" }}>{dataStatus.liveCount} 个为自动抓取的真实数据</span>。以下指标当前未能自动取数或需人工维护,展示的是占位/上次值:
          </div>
          {dataStatus.stale.length > 0 && (
            <div className="mb-3">
              <div className="text-xs mb-1.5" style={{ fontFamily: MONO, color: "#e8c558" }}>未提取到数据 ({dataStatus.stale.length}) — 接口失败或被拒,等待下次运行</div>
              <div className="flex flex-wrap gap-1">
                {dataStatus.stale.map((id) => nodeById[id] && (
                  <button key={id} onClick={() => selectNode(id)} className="px-1.5 py-0.5 rounded text-xs border hover:opacity-80"
                    style={{ borderColor: "rgba(232,197,88,0.35)", color: "#d9c27a", background: "rgba(232,197,88,0.06)" }}>
                    {nodeById[id].name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dataStatus.manual.length > 0 && (
            <div className="mb-3">
              <div className="text-xs mb-1.5" style={{ fontFamily: MONO, color: "#9fb0c4" }}>需手动输入 ({dataStatus.manual.length}) — 无免费数据源,在 pipeline/data_registry.yaml 中更新 value</div>
              <div className="flex flex-wrap gap-1">
                {dataStatus.manual.map((id) => nodeById[id] && (
                  <button key={id} onClick={() => selectNode(id)} className="px-1.5 py-0.5 rounded text-xs border hover:opacity-80"
                    style={{ borderColor: PANEL_BORDER, color: "#9fb0c4", background: "rgba(120,140,170,0.06)" }}>
                    {nodeById[id].name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dataStatus.proxy.length > 0 && (
            <div className="mb-3">
              <div className="text-xs mb-1.5" style={{ fontFamily: MONO, color: "#7f93ad" }}>代理/合成指标 ({dataStatus.proxy.length}) — 由其他真实序列派生</div>
              <div className="text-xs leading-relaxed" style={{ color: "#6c7f96" }}>
                {dataStatus.proxy.map((id) => nodeById[id]?.name).filter(Boolean).join(" · ")}
              </div>
            </div>
          )}
          {dataStatus.sourceErrors && Object.keys(dataStatus.sourceErrors).length > 0 && (
            <div className="mb-2">
              <div className="text-xs mb-1" style={{ fontFamily: MONO, color: "#7f93ad" }}>错误样本 (诊断用)</div>
              {Object.entries(dataStatus.sourceErrors).slice(0, 5).map(([k, v]) => (
                <div key={k} className="text-xs truncate" style={{ fontFamily: MONO, fontSize: 10, color: "#5d7088" }} title={v}>{k}: {v}</div>
              ))}
            </div>
          )}
          <div className="text-xs pt-2 border-t" style={{ color: "#46546a", borderColor: PANEL_BORDER }}>
            本面板仅为数据透明度声明,不影响图谱任何功能。
          </div>
        </div>
      )}

      {hoverNode && !panelOpen && (
        <div className="absolute z-40 pointer-events-none rounded-md border p-3 w-72"
          style={{
            left: Math.min(mouse.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
            top: Math.min(mouse.y + 14, (typeof window !== "undefined" ? window.innerHeight : 800) - 220),
            background: "rgba(8,12,19,0.94)", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)",
          }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: CATS[hoverNode.category].color }} />
              <span className="text-sm" style={{ color: "#e8eef6" }}>{hoverNode.name}</span>
            </div>
            <span className="flex items-center gap-1"><QualityTag n={hoverNode} /><span className="px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: MONO, fontSize: 10, color: "#0a0e16", background: STATUS[hoverNode.status].color }}>{hoverNode.status}</span></span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" style={{ fontFamily: MONO }}>
            <div><span style={{ color: TXT_DIM }}>当前值 </span><span style={{ color: "#e8eef6" }}>{fmtValue(hoverNode)}</span></div>
            <div><span style={{ color: TXT_DIM }}>分位数 </span><span style={{ color: hoverNode.percentile > 85 || hoverNode.percentile < 15 ? STATUS.EXTREME.color : "#c9d3e0" }}>{hoverNode.percentile}%</span></div>
            {[["1D", hoverNode.change1d], ["5D", hoverNode.change5d], ["20D", hoverNode.change20d]].map(([w, v]) => (
              <div key={w}><span style={{ color: TXT_DIM }}>{w} </span>
                <span style={{ color: v > 0 ? "#6fc28a" : v < 0 ? "#e07070" : TXT_DIM }}>{fmtChange(hoverNode, v)}</span></div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t text-xs leading-relaxed" style={{ borderColor: PANEL_BORDER, color: "#9fb0c4" }}>
            {hoverNode.description}
          </div>
        </div>
      )}

      {/* ====== 右侧详情面板 ====== */}
      <div className="absolute z-30 top-12 bottom-0 right-0 w-96 max-w-full border-l overflow-y-auto transition-transform duration-300"
        style={{ background: "rgba(8,12,19,0.95)", borderColor: PANEL_BORDER, backdropFilter: "blur(12px)", transform: panelOpen ? "translateX(0)" : "translateX(100%)" }}>
        {selectedNode && (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: CATS[selectedNode.category].color }} />
                  <span className="text-xs" style={{ color: TXT_DIM, fontFamily: MONO }}>{CATS[selectedNode.category].label} · {selectedNode.priority}</span>
                </div>
                <h2 className="text-base font-medium" style={{ color: "#eef3f9" }}>{selectedNode.name}</h2>
              </div>
              <button onClick={exitFocus} className="px-2 py-1 text-xs rounded border" style={{ borderColor: PANEL_BORDER, color: TXT_DIM }}>✕</button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-2xl" style={{ fontFamily: MONO, color: "#eef3f9" }}>{fmtValue(selectedNode)}</span>
              <span className="flex items-center gap-1.5"><QualityTag n={selectedNode} big /><span className="px-2 py-0.5 rounded text-xs" style={{ fontFamily: MONO, color: "#0a0e16", background: STATUS[selectedNode.status].color }}>{selectedNode.status}</span></span>
            </div>
            {(selectedNode.quality === "stale" || selectedNode.quality === "manual") && (
              <div className="mt-1 text-xs rounded px-2 py-1" style={{ color: selectedNode.quality === "stale" ? "#ffb38f" : "#9fb0c4", background: "rgba(20,27,40,0.6)", border: "1px solid rgba(70,90,120,0.3)" }}>
                {selectedNode.quality === "stale" ? "⚠ 本次未成功抓取, 当前显示占位值, 勿据此判断。" : "✎ 该指标暂无免费数据源, 数值为注册表手工维护。"}
              </div>
            )}
            <div className="grid grid-cols-4 gap-2 text-center text-xs" style={{ fontFamily: MONO }}>
              {[["1D", selectedNode.change1d], ["5D", selectedNode.change5d], ["20D", selectedNode.change20d], ["60D", selectedNode.change60d]].map(([w, v]) => (
                <div key={w} className="rounded border py-1.5" style={{ borderColor: timeWindow === w ? "#7e93b3" : PANEL_BORDER, background: "rgba(14,19,29,0.8)" }}>
                  <div style={{ color: TXT_DIM, fontSize: 10 }}>{w}</div>
                  <div style={{ color: v > 0 ? "#6fc28a" : v < 0 ? "#e07070" : TXT_DIM }}>{fmtChange(selectedNode, v)}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1" style={{ fontFamily: MONO }}>
                <span style={{ color: TXT_DIM }}>历史分位数</span><span style={{ color: "#c9d3e0" }}>{selectedNode.percentile}%</span>
              </div>
              <div className="h-1 rounded-full" style={{ background: "rgba(120,140,170,0.15)" }}>
                <div className="h-1 rounded-full" style={{ width: `${selectedNode.percentile}%`, background: selectedNode.percentile > 85 ? STATUS.EXTREME.color : "#7e93b3" }} />
              </div>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: "#9fb0c4" }}>{selectedNode.description}</p>

            {/* 时间序列 */}
            <div className="rounded border p-2" style={{ borderColor: PANEL_BORDER, background: "rgba(12,16,25,0.7)" }}>
              <div className="text-xs mb-1" style={{ fontFamily: MONO, color: TXT_DIM }}>TIME SERIES · {timeWindow}</div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <XAxis dataKey="d" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: TXT_DIM, fontFamily: MONO }} axisLine={false} tickLine={false} width={48} />
                    <RTooltip contentStyle={{ background: "#0b1019", border: `1px solid ${PANEL_BORDER}`, fontSize: 11, fontFamily: MONO, color: TXT }}
                      labelFormatter={() => ""} formatter={(v) => [v, selectedNode.unit || ""]} />
                    <ReferenceLine y={selectedNode.value} stroke="rgba(160,180,210,0.2)" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="value" stroke={CATS[selectedNode.category].color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 上下游 */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>上游驱动 ({upstream.length})</div>
                <div className="space-y-1">
                  {upstream.map(({ e, n }) => (
                    <button key={e.id} onClick={() => selectNode(n.id)} className="w-full text-left px-2 py-1 rounded border hover:opacity-80"
                      style={{ borderColor: PANEL_BORDER, background: "rgba(14,19,29,0.6)" }}>
                      <span style={{ color: e.relation === "negative" ? "#e07070" : "#6fc28a", fontFamily: MONO }}>{e.relation === "negative" ? "−" : e.relation === "conditional" ? "~" : "+"}</span>
                      <span className="ml-1.5" style={{ color: "#c9d3e0" }}>{n.name}</span>
                    </button>
                  ))}
                  {!upstream.length && <div style={{ color: TXT_DIM }}>—</div>}
                </div>
              </div>
              <div>
                <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>下游影响 ({downstream.length})</div>
                <div className="space-y-1">
                  {downstream.map(({ e, n }) => (
                    <button key={e.id} onClick={() => selectNode(n.id)} className="w-full text-left px-2 py-1 rounded border hover:opacity-80"
                      style={{ borderColor: PANEL_BORDER, background: "rgba(14,19,29,0.6)" }}>
                      <span style={{ color: e.relation === "negative" ? "#e07070" : "#6fc28a", fontFamily: MONO }}>{e.relation === "negative" ? "−" : e.relation === "conditional" ? "~" : "+"}</span>
                      <span className="ml-1.5" style={{ color: "#c9d3e0" }}>{n.name}</span>
                    </button>
                  ))}
                  {!downstream.length && <div style={{ color: TXT_DIM }}>—</div>}
                </div>
              </div>
            </div>

            {/* 激活路径 / 背离 / 失效条件 */}
            {relatedPaths.length > 0 && (
              <div className="text-xs">
                <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>相关激活路径</div>
                {relatedPaths.map((p) => (
                  <button key={p.id} onClick={() => { setFocusPathId(p.id); setFocusDivId(null); }}
                    className="w-full text-left px-2 py-1.5 rounded border mb-1" style={{ borderColor: "rgba(255,217,160,0.25)", color: "#ffd9a0", background: "rgba(255,217,160,0.05)" }}>
                    → {p.label}
                  </button>
                ))}
              </div>
            )}
            {relatedDivs.length > 0 && (
              <div className="text-xs">
                <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>当前变量背离</div>
                {relatedDivs.map((d) => (
                  <button key={d.id} onClick={() => focusDivergence(d)}
                    className="w-full text-left px-2 py-1.5 rounded border mb-1"
                    style={{ borderColor: "rgba(224,85,200,0.3)", color: "#e8b5e0", background: "rgba(224,85,200,0.06)" }}>
                    ◈ {d.title}
                  </button>
                ))}
              </div>
            )}
            <div className="text-xs rounded border p-2.5" style={{ borderColor: "rgba(255,82,82,0.25)", background: "rgba(255,82,82,0.05)" }}>
              <div className="mb-1" style={{ color: STATUS.INVALIDATED.color, fontFamily: MONO }}>逻辑失效条件</div>
              <div style={{ color: "#b9a3a8" }}>{selectedNode.invalidation || "暂无显著失效条件,维持常规传导框架监控。"}</div>
            </div>
          </div>
        )}

        {focusDiv && (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs mb-1" style={{ fontFamily: MONO, color: STATUS.DIVERGENCE.color }}>DIVERGENCE · {focusDiv.window}</div>
                <h2 className="text-base font-medium leading-snug" style={{ color: "#f0e3ef" }}>{focusDiv.title}</h2>
              </div>
              <button onClick={exitFocus} className="px-2 py-1 text-xs rounded border" style={{ borderColor: PANEL_BORDER, color: TXT_DIM }}>✕</button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="rounded border p-2.5" style={{ borderColor: PANEL_BORDER, background: "rgba(14,19,29,0.7)" }}>
                <div style={{ color: TXT_DIM, fontFamily: MONO }}>拓扑预期</div>
                <div className="mt-0.5" style={{ color: "#c9d3e0" }}>{focusDiv.expectedRelation}</div>
              </div>
              <div className="rounded border p-2.5" style={{ borderColor: "rgba(224,85,200,0.3)", background: "rgba(224,85,200,0.06)" }}>
                <div style={{ color: STATUS.DIVERGENCE.color, fontFamily: MONO }}>实际表现</div>
                <div className="mt-0.5" style={{ color: "#e9d2e6" }}>{focusDiv.observedRelation}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs" style={{ fontFamily: MONO }}>
              {[["持续性", focusDiv.persistence], ["强度", focusDiv.strength], ["失效风险", focusDiv.invalidationRisk]].map(([k, v]) => (
                <div key={k} className="rounded border py-1.5" style={{ borderColor: PANEL_BORDER, background: "rgba(14,19,29,0.8)" }}>
                  <div style={{ color: TXT_DIM, fontSize: 10 }}>{k}</div>
                  <div style={{ color: v === "HIGH" || v === "STRUCTURAL" ? STATUS.INVALIDATED.color : v === "MEDIUM" || v === "PERSISTENT" ? STATUS.ELEVATED.color : "#c9d3e0" }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="text-xs">
              <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>涉及节点</div>
              <div className="flex flex-wrap gap-1.5">
                {focusDiv.relatedNodeIds.map((id) => {
                  const n = nodeById[id];
                  return (
                    <button key={id} onClick={() => selectNode(id)} className="px-2 py-0.5 rounded-full border flex items-center gap-1.5"
                      style={{ borderColor: CATS[n.category].color, color: "#dde6f0", background: "rgba(12,17,26,0.7)" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATS[n.category].color }} />{n.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="text-xs">
              <div className="mb-1.5" style={{ color: TXT_DIM, fontFamily: MONO }}>可能的替代解释</div>
              <div className="space-y-1.5">
                {focusDiv.alternativeExplanations.map((a, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span style={{ color: "#8fa9cc", fontFamily: MONO }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ color: "#aab8c8" }}>{a}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs rounded border p-2.5" style={{ borderColor: "rgba(255,82,82,0.25)", background: "rgba(255,82,82,0.05)" }}>
              <div className="mb-1" style={{ color: STATUS.INVALIDATED.color, fontFamily: MONO }}>是否可能导致原逻辑失效</div>
              <div style={{ color: "#b9a3a8" }}>
                {focusDiv.invalidationRisk === "HIGH"
                  ? "高:若背离持续超过20个交易日,原传导逻辑应标记为 INVALIDATED 并切换替代框架。"
                  : focusDiv.invalidationRisk === "MEDIUM"
                    ? "中:继续观察,若背离强度升级或持续性转为 PERSISTENT 则升级处理。"
                    : "低:大概率为暂时性噪音,维持原框架。"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====== 底部图例 ====== */}
      <div className="absolute z-10 left-4 bottom-4 hidden md:flex items-center gap-4 px-3 py-2 rounded-md border text-xs"
        style={{ background: "rgba(8,12,19,0.7)", borderColor: PANEL_BORDER, fontFamily: MONO, fontSize: 10 }}>
        <span style={{ color: TXT_DIM }}>EDGES</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-px" style={{ background: EDGE_STYLE.ACTIVE.color }} /><span style={{ color: TXT_DIM }}>激活路径</span></span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-px" style={{ background: EDGE_STYLE.DIVERGENCE.color }} /><span style={{ color: TXT_DIM }}>背离</span></span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-px" style={{ background: EDGE_STYLE.INVALIDATED.color }} /><span style={{ color: TXT_DIM }}>失效/异常</span></span>
        <span style={{ color: "#46546a" }}>徽章: 派生/手工/未取到 · 拖拽旋转 · 滚轮缩放 · 点击节点查看详情</span>
        {dataStatus && (
          <button onClick={() => setDataNoticeOpen((v) => !v)}
            className="px-2 py-0.5 rounded border text-xs"
            style={{ fontFamily: MONO, borderColor: dataStatus.stale.length ? "rgba(232,197,88,0.5)" : PANEL_BORDER, color: dataStatus.stale.length ? "#e8c558" : TXT_DIM, background: "rgba(15,20,30,0.85)" }}>
            ⚠ 数据状态 · {dataStatus.stale.length}未取到 / {dataStatus.manual.length}手动
          </button>
        )}
      </div>
    </div>
  );
}
