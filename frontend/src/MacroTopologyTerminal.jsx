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

const RAW_NODES = [
  // —— 利率与货币政策 ——
  N("us10y", "美国10年期国债收益率", "rates", "P0", 4.56, "%", 0.025, 0.09, 0.16, 0.28, 88, "ELEVATED",
    "能源冲击推升通胀与加息预期,10Y升至4.56%;20Y/30Y重回5%上方,长端领涨。",
    "若美伊停火落地且油价回落至80美元下方,通胀-加息定价链条将松动,收益率或快速回落。"),
  N("us2y", "美国2年期国债收益率", "rates", "P1", 4.13, "%", 0.013, 0.06, 0.18, 0.30, 86, "ELEVATED",
    "12月加息25bp已被完全定价、10月概率约52%,短端跟随政策预期上移。"),
  N("us10yreal", "美国10年期实际利率", "rates", "P0", 2.01, "%", 0.02, 0.06, 0.10, 0.20, 84, "ELEVATED",
    "名义利率上行快于通胀补偿,实际利率走高,压制黄金与长久期成长资产。(10Y−盈亏平衡口径,估算)",
    "若加息预期回吐或盈亏平衡补涨,实际利率上行将放缓。"),
  N("us10ybe", "美国10年期盈亏平衡通胀", "rates", "P1", 2.55, "%", 0.01, 0.03, 0.06, 0.08, 72, "NORMAL",
    "油价大涨、CPI达4.2%,但通胀补偿仅温和上行——市场定价能源冲击为暂时性。(估算)"),
  N("fedfunds", "美联储政策利率", "rates", "P1", 3.83, "%", 0.0, 0.0, 0.0, 0.0, 70, "NORMAL",
    "现行有效联邦基金利率;市场焦点在年内重启加息的路径而非当前水平。(估算)"),
  N("fedpath", "美联储政策利率预期(1Y远期)", "rates", "P0", 4.30, "%", 0.02, 0.08, 0.22, 0.35, 90, "EXTREME",
    "强劲非农叠加CPI三年新高,12月加息已100%定价、10月概率约52%;ECB与BOJ本月亦预期加息。",
    "若核心通胀连续两月回落且停火持续、油价显著走低,加息定价将快速回吐。"),
  N("termprem", "美债10Y期限溢价", "rates", "P0", 0.92, "%", 0.01, 0.04, 0.08, 0.14, 88, "ELEVATED",
    "长端领涨、30Y站上5%,通胀不确定性推动期限溢价走阔。(ACM口径,估算)"),
  N("us30y", "美国30年期国债收益率", "rates", "P2", 5.03, "%", 0.025, 0.08, 0.15, 0.25, 93, "EXTREME",
    "30Y重回5%上方,长端对通胀与久期风险最敏感,本轮抛售由长端主导。"),
  N("t2s10s", "美债2s10s利差", "rates", "P2", 0.42, "%", 0.01, 0.03, -0.02, -0.02, 60, "NORMAL",
    "曲线维持正斜率约42bp,长短端同步上移。"),
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
  N("dxy", "美元指数", "fx", "P0", 99.9, "idx", 0.0, 0.5, 1.2, 2.4, 80, "ELEVATED",
    "加息预期+避险需求推动美元逼近100关口、接近九周高位;周二停火传闻一度令其回落。"),
  N("usdcny", "美元兑人民币", "fx", "P1", 6.777, "", 0.06, -0.02, -0.8, -2.5, 4, "DIVERGENCE",
    "人民币升至近12个月最强(6.76一线);5月出口创纪录(+19.4%)带来强劲结汇,与美元指数走强形成背离。"),
  N("eurusd", "欧元兑美元", "fx", "P2", 1.072, "", -0.1, -0.4, -1.0, -2.0, 30, "NORMAL",
    "ECB亦预期加息,但美元利差与避险占优,欧元承压。(估算)"),
  N("usdjpy", "美元兑日元", "fx", "P1", 146.5, "", -0.2, -1.0, -2.0, -3.5, 35, "NORMAL",
    "BOJ本月加息预期升温,日元相对走强,美元升势主要体现在欧系货币。(估算)"),
  N("usdcnh", "美元兑离岸人民币", "fx", "P3", 7.2, "", -0.1, -0.5, -0.9, -1.3, 44, "NORMAL", "离岸价差稳定,无明显贬值预期。"),
  N("gbpusd", "英镑兑美元", "fx", "P3", 1.298, "", 0.2, 1.1, 1.6, 0.9, 66, "NORMAL", "英镑随美元走弱被动升值。"),
  N("audusd", "澳元兑美元", "fx", "P3", 0.672, "", 0.3, 1.4, 2.2, 1.8, 58, "NORMAL", "商品货币受铜价与中国需求改善支撑。"),

  // —— 通胀 ——
  N("uscpi", "美国CPI(同比)", "inflation", "P0", 4.2, "%YoY", 0.0, 0.0, 0.5, 0.9, 97, "EXTREME",
    "5月CPI同比4.2%,创2023年4月以来新高,能源是主要推手;核心环比仅+0.2%不及预期。",
    "停火持续+油价回落情形下,高基数将使未来两期CPI快速回落。"),
  N("uscorecpi", "美国核心CPI(同比)", "inflation", "P1", 2.9, "%YoY", 0.0, 0.0, 0.2, 0.3, 75, "ELEVATED",
    "核心CPI同比2.9%为七个月高点,但环比+0.2%低于预期——能源冲击尚未明显传导至核心。"),
  N("uspce", "美国核心PCE(同比)", "inflation", "P2", 2.8, "%YoY", 0.0, 0.0, 0.1, 0.1, 62, "NORMAL", "联储目标口径通胀温和。"),
  N("cncpi", "中国CPI(同比)", "inflation", "P2", 0.6, "%YoY", 0.0, 0.1, 0.2, 0.3, 12, "NORMAL", "国内通胀低位,需求端弹性有限。"),
  N("cnppi", "中国PPI(同比)", "inflation", "P2", -1.8, "%YoY", 0.1, 0.3, 0.5, 0.8, 9, "NORMAL",
    "PPI仍处通缩区间,但跌幅随工业品需求改善收窄。"),
  N("infl5y5y", "美国5y5y通胀互换", "inflation", "P2", 2.48, "%", 0.0, 0.01, 0.03, 0.05, 65, "NORMAL",
    "长期通胀预期大体锚定,未随现货能源失锚。(估算)"),
  N("crb", "CRB商品指数", "inflation", "P2", 612, "idx", 0.8, 3.5, 6.0, 12.0, 90, "ELEVATED",
    "能源权重推动商品指数走高,工业金属高位震荡。(以S&P GSCI为代理,估算)"),

  // —— 增长 ——
  N("uspmi", "美国制造业PMI", "growth", "P1", 49.2, "idx", 0.0, 0.4, -0.6, -1.1, 38, "NORMAL", "美国制造业仍在荣枯线下方徘徊。"),
  N("cnpmi", "中国制造业PMI", "growth", "P1", 49.4, "idx", 0.0, 0.0, -0.4, -0.7, 30, "DIVERGENCE",
    "5月制造业PMI走弱(假期扰动+原材料成本上升),与出口创纪录形成内外需背离。(估算)"),
  N("cnpminew", "中国PMI新订单", "growth", "P1", 51.2, "idx", 0.0, 0.8, 1.5, 1.9, 72, "ELEVATED",
    "新订单重回扩张区间,领先指向工业品需求边际改善。"),
  N("indprod", "中国工业增加值(同比)", "growth", "P2", 5.6, "%YoY", 0.0, 0.2, 0.4, 0.5, 58, "NORMAL", "工业生产平稳偏强。"),
  N("retail", "社会消费品零售总额(同比)", "growth", "P2", 4.2, "%YoY", 0.0, 0.1, 0.3, 0.2, 41, "NORMAL", "消费温和修复,弹性仍受收入预期约束。"),
  N("fai", "固定资产投资(累计同比)", "growth", "P2", 3.5, "%YoY", 0.0, 0.1, 0.2, 0.1, 33, "NORMAL", "投资增速平稳,基建托底。"),
  N("nfp", "美国非农新增就业", "growth", "P2", 240, "k", 0, 65, 80, 60, 80, "ELEVATED",
    "上周非农大超预期,劳动力市场重新加速,直接强化年内加息预期。(估算)"),
  N("unemp", "美国失业率", "growth", "P3", 4.1, "%", 0.0, 0.0, 0.1, 0.2, 60, "NORMAL", "失业率小幅抬升但仍处低位。"),
  N("exports", "中国出口(同比)", "growth", "P3", 19.4, "%YoY", 0.0, 0.0, 11.0, 13.0, 99, "EXTREME",
    "5月出口同比+19.4%、3768亿美元创历史纪录,AI技术与新能源产品需求驱动。"),
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
  N("riskappetite", "全球风险偏好指数", "liquidity", "P1", -1.4, "idx", -0.3, -0.9, -1.2, -0.6, 15, "ELEVATED",
    "风险偏好快速恶化:VIX跳升、成长股重挫,但避险资金未流向黄金。(合成指标,估算)"),
  N("northbound", "北向资金(5D净流入)", "liquidity", "P3", 56, "亿元", 12, 56, 88, 120, 61, "NORMAL", "外资温和回流A股。"),

  // —— 信用 ——
  N("hyspread", "美国高收益债信用利差", "credit", "P0", 3.45, "%", 0.02, 0.08, 0.15, 0.10, 55, "DIVERGENCE",
    "股票大跌但高收益利差仅温和走阔——信用市场定价估值压缩而非违约周期。(估算)"),
  N("igspread", "美国投资级信用利差", "credit", "P1", 1.12, "%", 0.0, 0.01, -0.02, -0.05, 18, "NORMAL", "投资级利差处于历史低位区间。"),
  N("vix", "VIX指数", "credit", "P1", 22.0, "idx", 2.1, 3.1, 6.5, 4.0, 80, "ELEVATED",
    "VIX升至22(单日+10%);6月5日曾单日+40%;3月高点29.5,波动中枢明显抬升。"),
  N("move", "MOVE利率波动率指数", "credit", "P2", 77.0, "idx", 1.0, 3.0, -5.0, -25.0, 45, "NORMAL",
    "利率隐含波动率自3月115高点显著回落,债市相对股市更平静。"),

  // —— 资产 ——
  N("gold", "黄金", "asset", "P0", 4132, "$/oz", -3.6, -5.4, -8.1, -6.0, 82, "DIVERGENCE",
    "地缘冲突持续升级,黄金却跌至七个月低位——避险逻辑失效,加息预期与实际利率主导定价,叠加高位获利了结与美元走强。",
    "若加息预期显著回吐,或冲突升级至封锁霍尔木兹,黄金或重拾避险属性,该背离消解。"),
  N("oil", "原油(WTI)", "asset", "P1", 89.3, "$/bbl", -0.1, 4.5, 12.0, 28.0, 97, "EXTREME",
    "美伊冲突与霍尔木兹海峡风险推升油价至90美元附近,同比+38%;OPEC 5月产量创20余年新低,美原油库存单周-723万桶远超预期。",
    "停火协议正式落地并经一周验证、油价回落至80美元下方,则能源冲击主线失效。"),
  N("copper", "铜(LME)", "asset", "P1", 13850, "$/t", -0.34, -1.0, -2.1, 8.0, 95, "ELEVATED",
    "6月2日创历史新高后小幅回落;Jefferies预计2030年前年均供给缺口49万吨;中国AI/新能源产品出口需求强劲。"),
  N("csi300", "沪深300", "asset", "P1", 4660, "idx", -0.5, -1.2, -0.8, 4.5, 70, "NORMAL",
    "A股温和回调,出口高景气提供基本面支撑。(估算)"),
  N("ndx", "纳斯达克100", "asset", "P0", 28230, "idx", -1.9, -7.5, -8.5, -3.0, 70, "EXTREME",
    "半导体抛售(博通财报+AI资本开支怀疑+Meta巨额增发)叠加利率上行,科技领跌;6月5日单日-4.77%、芯片市值单周蒸发逾1万亿美元。"),
  N("spx", "标普500", "asset", "P1", 7267, "idx", -1.62, -4.4, -5.0, -1.5, 72, "ELEVATED",
    "CPI高企叠加美伊局势,主要板块普跌(工业-3%);但小盘与价值相对抗跌。"),
  N("cnbond", "中国10年期国债期货", "asset", "P2", 108.4, "idx", 0.0, 0.1, 0.3, 0.5, 86, "NORMAL", "中债期货高位运行,与美债走势分化。"),
  N("convert", "中证可转债指数", "asset", "P2", 412, "idx", 0.1, 0.6, 1.4, 2.6, 55, "NORMAL", "转债跟随权益温和修复,估值中性。"),
  N("comidx", "南华商品指数", "asset", "P2", 226, "idx", 0.4, 2.2, 4.1, 5.8, 66, "ELEVATED", "商品指数受铜与原油带动走强。"),
  N("chipetf", "芯片ETF", "asset", "P2", 1.48, "", -2.5, -12.0, -16.0, -5.0, 55, "EXTREME",
    "全球半导体重挫共振:博通业绩引发抛售、AI叙事遭质疑,板块自高位深度回撤。(以512760为锚,估算)"),
  N("bankidx", "银行指数", "asset", "P1", 7050, "idx", -0.5, 0.5, 1.5, 4.0, 78, "NORMAL",
    "高利率环境下银行/价值相对抗跌,资金自成长股持续轮出。(估算)"),
  N("valueidx", "价值风格指数", "asset", "P2", 5320, "idx", -0.8, -1.0, 0.5, 2.0, 70, "NORMAL",
    "价值显著跑赢成长,利率久期再定价驱动风格轮动。(估算)"),
  N("growthidx", "成长风格指数", "asset", "P2", 6480, "idx", -1.8, -6.5, -7.5, -2.0, 60, "DIVERGENCE",
    "成长风格随利率上行与AI怀疑情绪大幅回撤,与价值的剪刀差快速拉大。(估算)"),
  N("hsi", "恒生指数", "asset", "P3", 24380, "idx", -0.11, -0.8, -1.5, 3.0, 65, "NORMAL",
    "港股相对美股明显抗跌。"),
  N("em", "新兴市场股指(MSCI EM)", "asset", "P3", 1124, "idx", 0.3, 1.2, 2.0, 2.8, 57, "NORMAL", "美元走弱为新兴市场提供喘息。"),
  N("goldminers", "黄金矿业股", "asset", "P3", 41.2, "idx", 1.2, 5.4, 9.0, 14.2, 95, "ELEVATED", "矿业股弹性放大金价上行。"),

  // —— 风险事件 ——
  N("fiscalsupply", "美债财政供给压力", "risk", "P0", 1.2, "idx", 0.0, 0.1, 0.2, 0.3, 75, "NORMAL",
    "财政供给仍高,但已非当前主导因素;市场焦点切换至能源-通胀-加息链条。"),
  N("fiscalworry", "财政信用担忧指数", "risk", "P1", 0.4, "idx", 0.0, -0.2, -0.5, -0.3, 55, "NORMAL",
    "财政信用担忧暂被通胀交易掩盖;黄金下跌亦反映该对冲需求阶段性降温。"),
  N("geopolitics", "地缘政治风险指数", "risk", "P2", 285, "idx", 12, 45, 90, 130, 98, "EXTREME",
    "美伊连日互袭:美军直升机被击落后发动“自卫打击”,伊朗以导弹无人机袭击霍尔木兹海峡美舰;数周“停火”反复破裂。",
    "双方正式停火并经两周验证、GPR回落至150下方,则地缘主线降级。"),
  N("debtceiling", "债务上限博弈风险", "risk", "P3", 22, "idx", 0, 1, 2, 4, 38, "NORMAL", "短期无到期窗口,风险温和。"),
];

/* ----------------------- 模拟数据:边 ----------------------- */
// E(id, source, target, relation, status, mechanism, strength)
const E = (id, source, target, relation, status, mechanism, strength) =>
  ({ id, source, target, relation, status, mechanism, strength });

const RAW_EDGES = [
  // 主导路径:财政供给 → 期限溢价 → 长端 → 实际利率 → 成长股
  E("e_supply_tp", "fiscalsupply", "termprem", "positive", "ACTIVE", "国债净供给放量推升期限溢价", 0.9),
  E("e_worry_tp", "fiscalworry", "termprem", "positive", "INACTIVE", "财政可持续性担忧要求更高久期补偿", 0.8),
  E("e_tp_10y", "termprem", "us10y", "positive", "ACTIVE", "期限溢价走阔直接抬升长端名义利率", 0.9),
  E("e_10y_real", "us10y", "us10yreal", "positive", "ACTIVE", "名义上行+盈亏平衡持稳 → 实际利率上行", 0.85),
  E("e_real_ndx", "us10yreal", "ndx", "negative", "ACTIVE", "实际利率上行压制长久期成长估值", 0.85),
  E("e_real_growth", "us10yreal", "growthidx", "negative", "ACTIVE", "贴现率冲击集中作用于成长风格", 0.7),
  E("e_move_tp", "move", "termprem", "positive", "ACTIVE", "利率波动率上行抬升期限溢价补偿", 0.6),
  E("e_supply_worry", "fiscalsupply", "fiscalworry", "positive", "ACTIVE", "供给压力强化财政可持续性担忧", 0.6),
  E("e_worry_gold", "fiscalworry", "gold", "positive", "INACTIVE", "法币信用对冲需求推升黄金", 0.75),
  E("e_worry_dxy", "fiscalworry", "dxy", "negative", "INACTIVE", "财政信用担忧驱动美元贬值压力", 0.7),
  E("e_10y_bank", "us10y", "bankidx", "positive", "ACTIVE", "利率上行+曲线陡峭化改善银行息差", 0.6),

  // 背离边
  E("e_real_gold", "us10yreal", "gold", "negative", "ACTIVE", "实际利率与黄金的传统负相关本期失效:同步上行", 0.8),
  E("e_10y_dxy", "us10y", "dxy", "positive", "ACTIVE", "利差逻辑被资金流出与财政信用担忧抵消:收益率↑美元↓", 0.8),
  E("e_spx_hy", "spx", "hyspread", "negative", "DIVERGENCE", "股票下跌但信用利差未走阔,信用市场未确认风险", 0.7),
  E("e_oil_be", "oil", "us10ybe", "positive", "DIVERGENCE", "油价上行未带动盈亏平衡通胀,通胀预期未确认", 0.55),
  E("e_style", "growthidx", "valueidx", "conditional", "DIVERGENCE", "成长/价值风格剧烈分化:利率冲击下的内部撕裂", 0.6),

  // 失效边
  E("e_fed_dxy", "fedpath", "dxy", "positive", "ACTIVE", "『鹰派预期→强美元』机制当前被财政信用溢价覆盖,逻辑可能失效", 0.6),

  // 利率内部
  E("e_fed_2y", "fedpath", "us2y", "positive", "ACTIVE", "政策路径预期锚定短端", 0.8),
  E("e_2y_10y", "us2y", "us10y", "positive", "ACTIVE", "短端预期沿曲线传导", 0.5),
  E("e_be_10y", "us10ybe", "us10y", "positive", "INACTIVE", "通胀补偿构成名义利率", 0.5),
  E("e_ff_fedpath", "fedfunds", "fedpath", "positive", "INACTIVE", "现行利率构成路径起点", 0.4),
  E("e_10y_30y", "us10y", "us30y", "positive", "ACTIVE", "长端联动,超长端对供给更敏感", 0.7),
  E("e_10y_curve", "us10y", "t2s10s", "positive", "INACTIVE", "长端领涨推动曲线熊陡", 0.6),
  E("e_jgb_10y", "jgb10y", "us10y", "positive", "INACTIVE", "全球久期供需联动,日债上行外溢", 0.4),
  E("e_bund_10y", "bund10y", "us10y", "positive", "INACTIVE", "欧美利率联动", 0.35),
  E("e_real_chip", "us10yreal", "chipetf", "negative", "ACTIVE", "实际利率冲击高久期科技资产", 0.55),
  E("e_10y_value", "us10y", "valueidx", "positive", "INACTIVE", "利率上行环境利好价值风格", 0.5),

  // 通胀 → 政策
  E("e_cpi_fed", "uscpi", "fedpath", "positive", "ACTIVE", "通胀粘性约束降息节奏", 0.65),
  E("e_core_fed", "uscorecpi", "fedpath", "positive", "INACTIVE", "核心通胀决定政策容忍度", 0.6),
  E("e_pce_fed", "uspce", "fedpath", "positive", "INACTIVE", "联储目标口径直接输入反应函数", 0.6),
  E("e_nfp_fed", "nfp", "fedpath", "positive", "ACTIVE", "就业强度影响政策预期", 0.5),
  E("e_claims_fed", "usclaims", "fedpath", "negative", "INACTIVE", "初请上行→宽松预期升温", 0.4),
  E("e_unemp_fed", "unemp", "fedpath", "negative", "INACTIVE", "失业率抬升触发宽松定价", 0.45),
  E("e_oil_cpi", "oil", "uscpi", "positive", "ACTIVE", "能源价格直接传导至总体CPI", 0.6),
  E("e_crb_cpi", "crb", "uscpi", "positive", "INACTIVE", "商品价格领先商品通胀分项", 0.45),
  E("e_oil_ppi", "oil", "cnppi", "positive", "INACTIVE", "输入性成本影响PPI", 0.5),

  // 中国需求链(激活)
  E("e_neworder_dem", "cnpminew", "inddemand", "positive", "ACTIVE", "新订单领先工业品实物需求", 0.7),
  E("e_dem_copper", "inddemand", "copper", "positive", "ACTIVE", "需求改善推升铜价", 0.7),
  E("e_copper_com", "copper", "comidx", "positive", "ACTIVE", "铜价带动商品指数走强", 0.6),

  // 中国内部
  E("e_fai_dem", "fai", "inddemand", "positive", "INACTIVE", "投资形成实物工作量", 0.5),
  E("e_indprod_dem", "indprod", "inddemand", "positive", "INACTIVE", "生产与需求互为印证", 0.4),
  E("e_export_pmi", "exports", "cnpmi", "positive", "DIVERGENCE", "外需支撑制造业景气", 0.5),
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
  E("e_dxy_gold", "dxy", "gold", "negative", "ACTIVE", "美元计价效应", 0.5),
  E("e_dxy_cny", "dxy", "usdcny", "positive", "DIVERGENCE", "美元强弱主导人民币双边汇率", 0.7),
  E("e_dxy_eur", "dxy", "eurusd", "negative", "INACTIVE", "指数权重镜像关系", 0.8),
  E("e_dxy_jpy", "dxy", "usdjpy", "positive", "INACTIVE", "美日利差与美元定价", 0.6),
  E("e_dxy_cnh", "dxy", "usdcnh", "positive", "INACTIVE", "离岸联动", 0.6),
  E("e_dxy_gbp", "dxy", "gbpusd", "negative", "INACTIVE", "镜像关系", 0.6),
  E("e_dxy_aud", "dxy", "audusd", "negative", "INACTIVE", "美元与商品货币反向", 0.5),
  E("e_dxy_em", "dxy", "em", "negative", "INACTIVE", "弱美元缓解新兴市场金融条件", 0.6),
  E("e_dxy_copper", "dxy", "copper", "negative", "INACTIVE", "美元计价商品反向", 0.45),

  // 金融条件与信用
  E("e_fedbs_fci", "fedbs", "usfci", "negative", "INACTIVE", "缩表边际收紧金融条件", 0.45),
  E("e_rrp_fci", "rrp", "usfci", "negative", "INACTIVE", "RRP消耗缓冲银行准备金", 0.35),
  E("e_fci_spx", "usfci", "spx", "negative", "INACTIVE", "金融条件收紧压制风险资产", 0.6),
  E("e_hy_fci", "hyspread", "usfci", "positive", "INACTIVE", "信用利差是金融条件分项", 0.5),
  E("e_ig_hy", "igspread", "hyspread", "positive", "INACTIVE", "信用利差同向联动", 0.6),
  E("e_vix_spx", "vix", "spx", "negative", "ACTIVE", "波动率与股指反向", 0.7),
  E("e_vix_risk", "vix", "riskappetite", "negative", "INACTIVE", "波动率抬升压制风险偏好", 0.6),
  E("e_move_vix", "move", "vix", "positive", "INACTIVE", "利率波动外溢至股票波动", 0.5),
  E("e_risk_ndx", "riskappetite", "ndx", "positive", "INACTIVE", "风险偏好支撑成长资产", 0.5),
  E("e_risk_em", "riskappetite", "em", "positive", "INACTIVE", "风险偏好驱动新兴市场资金流", 0.45),

  // 资产内部 / 风险事件
  E("e_ndx_spx", "ndx", "spx", "positive", "ACTIVE", "权重股拖累大盘", 0.8),
  E("e_chip_ndx", "chipetf", "ndx", "positive", "ACTIVE", "半导体是纳指核心权重", 0.7),
  E("e_gold_miners", "gold", "goldminers", "positive", "INACTIVE", "矿业股放大金价弹性", 0.7),
  E("e_com_crb", "comidx", "crb", "positive", "INACTIVE", "商品指数联动", 0.5),
  E("e_geo_oil", "geopolitics", "oil", "positive", "ACTIVE", "地缘冲击供给溢价", 0.5),
  E("e_geo_gold", "geopolitics", "gold", "positive", "INVALIDATED", "避险需求", 0.45),
  E("e_ceiling_worry", "debtceiling", "fiscalworry", "positive", "INACTIVE", "债务上限博弈放大财政担忧", 0.4),
  E("e_fci_hy2", "usfci", "hyspread", "positive", "INACTIVE", "条件收紧推升再融资成本", 0.4),
  E("e_sofr_fci", "sofr", "usfci", "positive", "INACTIVE", "货币市场利率传导", 0.3),
];

/* ----------------------- 模拟数据:激活路径 / 背离 ----------------------- */
const MOCK_PATHS = [
  { id: "p_energy", label: "地缘冲突 → 原油 → CPI → 加息预期 → 长端利率 → 纳指承压", nodeIds: ["geopolitics", "oil", "uscpi", "fedpath", "us10y", "ndx"] },
  { id: "p_style", label: "实际利率上行 → 成长重挫 / 价值与银行相对抗跌", nodeIds: ["us10yreal", "growthidx", "valueidx", "bankidx"] },
  { id: "p_china", label: "中国出口(纪录新高) → 工业品需求 → 铜 → 商品指数", nodeIds: ["exports", "inddemand", "copper", "comidx"] },
];

const MOCK_DIVERGENCES = [
  {
    id: "d1", title: "地缘冲突升级,黄金不涨反跌(避险失效)",
    relatedNodeIds: ["geopolitics", "gold", "us10yreal", "dxy"],
    relatedEdgeIds: ["e_geo_gold", "e_real_gold", "e_dxy_gold"],
    expectedRelation: "重大地缘风险升级 → 避险买盘流入 → 金价上行",
    observedRelation: "美伊连日互袭、GPR处于极端高位,黄金却 −5.4% (5D) 跌至七个月低位",
    window: "5D", strength: "HIGH", persistence: "PERSISTENT",
    alternativeExplanations: [
      "加息预期与实际利率上行主导定价,机会成本压倒避险需求",
      "前期涨幅过大,高位多头获利了结与保证金抛售放大跌势",
      "美元同步走强,分流传统避险资金",
    ],
    invalidationRisk: "HIGH",
  },
  {
    id: "d2", title: "能源冲击猛烈,核心通胀与通胀预期反应温和",
    relatedNodeIds: ["oil", "uscpi", "uscorecpi", "us10ybe"],
    relatedEdgeIds: ["e_oil_be"],
    expectedRelation: "能源冲击 → 核心通胀与长期通胀预期跟随上行",
    observedRelation: "WTI同比+38%、CPI达4.2%,但核心CPI环比仅+0.2%、10Y盈亏平衡仅温和上行",
    window: "20D", strength: "MEDIUM", persistence: "PERSISTENT",
    alternativeExplanations: [
      "市场将能源冲击定价为供给性、暂时性扰动",
      "高利率压制需求端,二次传导受阻",
      "长期通胀预期锚定良好(5y5y稳定)",
    ],
    invalidationRisk: "MEDIUM",
  },
  {
    id: "d3", title: "美元指数走强,人民币却创12个月新高",
    relatedNodeIds: ["dxy", "usdcny", "exports"],
    relatedEdgeIds: ["e_dxy_cny"],
    expectedRelation: "美元指数走强 → USDCNY上行(人民币承压)",
    observedRelation: "DXY逼近100、接近九周高位,USDCNY却降至6.78附近的12个月低位",
    window: "20D", strength: "MEDIUM", persistence: "PERSISTENT",
    alternativeExplanations: [
      "5月出口创纪录(+19.4%)带来强劲结汇需求",
      "出口结构升级(AI/新能源产品)提升贸易盈余质量",
      "政策引导与资本流入共同支撑人民币",
    ],
    invalidationRisk: "LOW",
  },
  {
    id: "d4", title: "股票大跌,信用利差未显著走阔",
    relatedNodeIds: ["spx", "ndx", "hyspread", "vix"],
    relatedEdgeIds: ["e_spx_hy"],
    expectedRelation: "风险资产大跌 → 高收益利差同步走阔定价违约风险",
    observedRelation: "纳指 −7.5% (5D)、VIX升至22,HY利差仅温和走阔(估算口径)",
    window: "5D", strength: "MEDIUM", persistence: "TRANSIENT",
    alternativeExplanations: [
      "下跌主因利率端估值压缩与AI叙事再定价,而非违约周期",
      "盈利与再融资环境尚未实质恶化",
    ],
    invalidationRisk: "MEDIUM",
  },
];

const MARKET_STATE = {
  topMover: { nodeId: "gold", text: "黄金 −5.4% / 5D · 七个月新低(避险失效)" },
  dominantPathId: "p_energy",
  regime: "ELEVATED",
  regimeNote: "真实数据校准:2026-06-10收盘(标注“估算”者为推算)。能源冲击驱动通胀再加速、加息预期重启;最大异常是黄金避险属性失效。",
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
      const radius = SPHERE_R * (0.93 + rnd() * 0.14);
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
   主组件
   ============================================================ */
export default function MacroTopologyTerminal({ live = null }) {
  /* ---------- 数据源: 真实数据优先, 内置演示数据回退 ---------- */
  const PATHS = live?.paths?.length ? live.paths : MOCK_PATHS;
  const DIVERGENCES = live?.divergences ?? MOCK_DIVERGENCES;
  const STATE = live?.marketState ?? MARKET_STATE;
  const isLive = !!live;

  /* ---------- 派生数据 ---------- */
  const nodes = useMemo(() => {
    const raw = live?.nodes?.length ? live.nodes : RAW_NODES;
    // 真实节点自带 history(管道产出); 缺失的(manual/derived/stale)用合成曲线兜底
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
  const [webglError, setWebglError] = useState(false);

  const mountRef = useRef(null);
  const rootRef = useRef(null);
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
      adjacency, pathEdgeIds,
      divergence: focusDivId ? DIVERGENCES.find((d) => d.id === focusDivId) : null,
    };
  }, [hoverId, selectedId, focusDivId, focusPathId, autoRotate, visibleSet, searchSet, adjacency, pathEdgeIds]);

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    /* 节点 */
    const nodeObjs = {};
    const coreSprites = [];
    nodes.forEach((n, idx) => {
      const p = positions[n.id];
      const color = new THREE.Color(CATS[n.category].color);
      const baseScale = n.priority === "P0" ? 0.78 : n.priority === "P1" ? 0.56 : n.priority === "P2" ? 0.44 : 0.36;

      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTex, color, transparent: true, opacity: 0.0, depthWrite: false }));
      core.position.copy(p); core.scale.setScalar(0.001);
      core.userData = { nodeId: n.id };
      group.add(core); coreSprites.push(core);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color.clone(), transparent: true, opacity: 0, depthWrite: false }));
      glow.position.copy(p); glow.scale.setScalar(baseScale * 2.6); glow.raycast = () => {};
      group.add(glow);

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
          dragging = true;
          sceneRef.current.focusQuat = null; // 拖拽取消聚焦
          group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * 0.005);
          group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), dy * 0.005);
        }
        lastPos = { x: ev.clientX, y: ev.clientY };
        if (dragging) { if (hoverLocal) { hoverLocal = null; setHoverId(null); } return; }
      }
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(coreSprites, false);
      const id = hits.length ? hits[0].object.userData.nodeId : null;
      if (id !== hoverLocal) { hoverLocal = id; setHoverId(id); }
      setMouse({ x: ev.clientX, y: ev.clientY });
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
    };
    const onPointerUp = (ev) => {
      if (!dragging && downPos) {
        if (hoverLocal) selectNodeRef.current(hoverLocal);
        else exitFocusRef.current();
      }
      downPos = null; dragging = false;
    };
    const onWheel = (ev) => {
      ev.preventDefault();
      const sc = sceneRef.current;
      sc.targetZ = THREE.MathUtils.clamp(sc.targetZ + ev.deltaY * 0.02, 13, 44);
    };
    const onLeave = () => { hoverLocal = null; setHoverId(null); };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    sceneRef.current = { renderer, scene, camera, group, nodeObjs, edgeObjs, focusQuat: null, targetZ: 26 };

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
      const intro = Math.min(1, t / 1.8);

      /* 相机 / 旋转 */
      camera.position.z += (sc.targetZ - camera.position.z) * 0.07;
      if (sc.focusQuat) {
        group.quaternion.slerp(sc.focusQuat, 0.06);
      } else if (ui.autoRotate) {
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
        if (!visible) { op = 0.04; glowOp = 0; ringOp = 0; }

        const labelTarget = (n.priority === "P0" && (!brightNodes || inBright) && visible && (!ui.searchSet || searchHit)) ? 0.85 : (brightNodes && inBright && visible ? 0.85 : 0.0);

        o.curScale += (scale * ease - o.curScale) * 0.14;
        o.curOp += (op * ease - o.curOp) * 0.12;
        o.curGlow += (glowOp * ease - o.curGlow) * 0.1;
        o.curRing += (ringOp * ease - o.curRing) * 0.12;
        o.curLabel += (labelTarget * ease - o.curLabel) * 0.1;

        o.core.scale.setScalar(Math.max(0.001, o.curScale));
        o.core.material.opacity = o.curOp;
        o.glow.scale.setScalar(Math.max(0.001, o.curScale * 2.9));
        o.glow.material.opacity = o.curGlow;
        if (n.status === "EXTREME") o.glow.material.color.set(STATUS.EXTREME.color);
        else if (n.status === "DIVERGENCE") o.glow.material.color.set(STATUS.DIVERGENCE.color);
        else o.glow.material.color.set(CATS[n.category].color);
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

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      Object.values(sceneRef.current?.nodeObjs || {}).forEach((o) => {
        o.core.material.dispose(); o.glow.material.dispose(); o.ring.material.dispose();
        if (o.label) { o.label.material.map?.dispose(); o.label.material.dispose(); }
      });
      Object.values(sceneRef.current?.edgeObjs || {}).forEach((o) => { o.line.geometry.dispose(); o.line.material.dispose(); });
      circleTex.dispose(); glowTex.dispose(); ringTex.dispose();
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
      <div ref={mountRef} className="absolute inset-0" />
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
          <span className="hidden lg:block text-xs" style={{ color: TXT_DIM, fontFamily: MONO }}>{isLive ? `LIVE · ${(STATE.updatedAt || "").slice(0, 16).replace("T", " ")} UTC` : "DEMO DATA"}</span>
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
            <span className="px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: MONO, fontSize: 10, color: "#0a0e16", background: STATUS[hoverNode.status].color }}>{hoverNode.status}</span>
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
              <span className="px-2 py-0.5 rounded text-xs" style={{ fontFamily: MONO, color: "#0a0e16", background: STATUS[selectedNode.status].color }}>{selectedNode.status}</span>
            </div>

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
        <span style={{ color: "#46546a" }}>拖拽旋转 · 滚轮缩放 · 点击节点查看详情</span>
      </div>
    </div>
  );
}
