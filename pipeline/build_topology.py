#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MACRO TOPOLOGY 数据管道
======================
读取 data_registry.yaml(75节点→数据源映射)+ nodes_meta.yaml(节点元信息)
+ edges.yaml(84条传导边),拉取真实数据,计算变化/分位/状态/背离,
输出前端 loaders.ts 直接消费的 5 个 JSON 文件。

用法:
    export FRED_API_KEY=xxxx          # https://fred.stlouisfed.org/docs/api/api_key.html 免费申请
    python build_topology.py --out ../output

设计原则:
    1. 任何单一数据源失败不阻塞整体:失败节点标记 stale 并沿用上次值(若有缓存);
    2. 全部判定规则(状态/激活/背离)集中在本文件 RULES 区,可单测、可审计;
    3. 输出 JSON 的字段与前端 types/topology.ts 完全一致。
"""
from __future__ import annotations
import argparse, json, math, os, sys, time, datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yaml

HERE = Path(__file__).parent
TODAY = dt.date.today()

# ------------------------------------------------------------------
# 1. Fetchers —— 每个数据源一个函数, 返回 pd.Series(DatetimeIndex, float)
# ------------------------------------------------------------------

# ---- 合理性校验: 提取值超出物理/历史合理区间 → 视为提取错误, 标stale不展示 ----
SANITY_RANGES = {
    "us3m": (0.0, 9), "us2y": (0.0, 9), "us5y": (0.0, 9), "us10y": (0.3, 9), "us20y": (0.5, 10), "us30y": (0.5, 10),
    "us5yreal": (-3, 6), "us10yreal": (-3, 6), "termprem": (-3, 5), "us10ybe": (0, 6), "infl5y5y": (0, 6),
    "cn1y": (0.3, 5), "cn5y": (0.5, 5.5), "cn10y": (0.8, 5.5), "cn30y": (1.0, 6), "dr007": (0.5, 5), "dr001": (0.3, 5),
    "lpr5y": (2.0, 6), "shibor3m": (0.5, 6), "cnusspread": (-5, 3),
    "dxy": (80, 130), "usdcny": (5.5, 9), "usdjpy": (80, 200), "eurusd": (0.8, 1.6),
    "gold": (1200, 9000), "silver": (10, 200), "copper": (1.5, 9), "oil": (15, 200), "brent": (15, 210),
    "natgas": (0.8, 20), "ironore": (40, 250), "rebar": (1500, 7000), "aluminum": (1200, 5000),
    "spx": (3000, 16000), "ndx": (10000, 45000), "rut": (1200, 5000), "sox": (2000, 12000),
    "csi300": (2000, 9000), "csi500": (3000, 12000), "chinext": (1000, 6000), "hsi": (12000, 45000), "hstech": (2000, 16000),
    "vix": (8, 90), "vvix": (60, 220), "hyspread": (150, 1500), "igspread": (40, 500),
    "uscpi": (-3, 16), "uscorecpi": (-2, 12), "cncpi": (-3, 10), "cnppi": (-12, 15),
    "margindebt": (0.3, 4.5), "netissue": (300, 20000), "bidcover": (1.2, 4.5),
    "tga": (50, 2000), "reserves": (1.5, 6), "mmf": (3, 12),
    "bdi": (300, 8000), "rigcount": (150, 1200), "opecprod": (2000, 4000), "pbocbs": (25, 80),
    "cftcgold": (-400000, 1200000), "goldetfflow": (-500, 500), "gscpi": (-3, 6),
}


def sanity_check(nid: str, s: "pd.Series") -> None:
    rng = SANITY_RANGES.get(nid)
    if rng is None or s is None or len(s) == 0:
        return
    v = float(s.iloc[-1])
    if not (rng[0] <= v <= rng[1]):
        raise ValueError(f"sanity: 提取值 {v} 超出合理区间 {rng}, 疑似列名/单位/解析错误")


FRED_KEY = os.environ.get("FRED_API_KEY", "")
if not FRED_KEY:
    print("=" * 70, file=sys.stderr)
    print("[FATAL-ish] FRED_API_KEY 为空! 全部FRED节点(约40个)将失败。", file=sys.stderr)
    print("  检查: GitHub仓库 Settings → Secrets and variables → Actions", file=sys.stderr)
    print("  确认存在名为 FRED_API_KEY 的 Repository secret。", file=sys.stderr)
    print("=" * 70, file=sys.stderr)
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "macro-topology-pipeline/1.0"


def fetch_fred(series: str, days: int) -> pd.Series:
    """FRED 免费限速 120次/分钟; 节点扩容后必须带退避重试, 否则一旦被限流会雪崩。"""
    start = (TODAY - dt.timedelta(days=days + 400)).isoformat()
    url = ("https://api.stlouisfed.org/fred/series/observations"
           f"?series_id={series}&api_key={FRED_KEY}&file_type=json&observation_start={start}")
    last_err = "unknown"
    for attempt in range(3):
        js = SESSION.get(url, timeout=30).json()
        if "observations" in js:
            s = pd.Series({o["date"]: o["value"] for o in js["observations"]})
            s.index = pd.to_datetime(s.index)
            return pd.to_numeric(s, errors="coerce").dropna()
        last_err = js.get("error_message", str(js)[:120])
        if attempt < 2:
            time.sleep(20)  # 大概率是限流, 等满一个窗口再试
    raise ValueError(f"FRED error: {last_err}")


def fetch_yahoo(ticker: str, days: int) -> pd.Series:
    import yfinance as yf
    df = yf.download(ticker, period=f"{max(days, 365)}d", interval="1d",
                     progress=False, auto_adjust=True)
    col = df["Close"]
    if isinstance(col, pd.DataFrame):  # yfinance 多级列兼容
        col = col.iloc[:, 0]
    return col.dropna()


def _parse_cn_month(x):
    """东方财富口径 '2026年04月份'/'2026年4月' → Timestamp(月末)。其余格式交给 to_datetime。"""
    import re as _re
    m = _re.search(r"(\d{4})\s*年\s*(?:\d{1,2}\s*-\s*)?(\d{1,2})\s*月", str(x))
    if m:  # 兼容 "2026年04月份" 与累计口径 "2026年1-4月"(取末月)
        return pd.Timestamp(int(m[1]), int(m[2]), 1) + pd.offsets.MonthEnd(0)
    return pd.to_datetime(x, errors="coerce")


def _pick_value_col(df: pd.DataFrame, date_col: str, prefer=None):
    """优先取指定/常见数值列; 要求转数值后有效率>50%, 排除全NaN的文本列(2026-06首跑事故根因)。"""
    candidates = ([prefer] if prefer else []) + ["今值", "收盘", "收盘价", "close", "value", "同比增长"]
    for c in candidates:
        if c and c in df.columns:
            return c
    for c in df.columns:
        if c == date_col:
            continue
        v = pd.to_numeric(df[c], errors="coerce")
        if v.notna().mean() > 0.5:
            return c
    raise ValueError(f"no numeric column in {list(df.columns)}")


def fetch_akshare(cfg: dict, days: int) -> pd.Series:
    """akshare 接口名偶有变更——所有兼容逻辑只写在这里。
    接口名与列名已对照 akshare 1.18.64 逐一核验 (2026-06)。"""
    import akshare as ak
    fn, code, column = cfg["fn"], cfg.get("code"), cfg.get("column")

    last_exc = None
    for attempt in range(3):  # 东财/金十偶发断连, 重试2次
        try:
            if fn == "bond_zh_us_rate":
                try:
                    df = ak.bond_zh_us_rate(start_date=(TODAY - dt.timedelta(days=days)).strftime("%Y%m%d"))
                except TypeError:  # 签名变更兜底
                    df = ak.bond_zh_us_rate()
                s = df.set_index("日期")[column]
            elif fn == "repo_rate_query":
                # 回购定盘利率 (chinamoney 官方): FR007 代理 R007, FDR007 代理 DR007
                symbol = "银银间回购定盘利率" if code.startswith("FDR") else "回购定盘利率"
                df = ak.repo_rate_query(symbol=symbol)
                s = df.set_index("date")[code]
            elif fn == "macro_china_lpr":
                df = ak.macro_china_lpr()
                dcol = "TRADE_DATE" if "TRADE_DATE" in df.columns else df.columns[0]
                vcol = "LPR1Y" if "LPR1Y" in df.columns else _pick_value_col(df, dcol)
                s = df.set_index(dcol)[vcol]
            elif fn == "macro_china_money_supply":
                # 实际列名: 货币(M1)-同比增长 / 货币和准货币(M2)-同比增长, 月份格式 '2026年04月份'
                df = ak.macro_china_money_supply()
                s = df.set_index(df["月份"].map(_parse_cn_month))[column]
            elif fn == "macro_china_shrzgm":
                # 当前接口只有'社会融资规模增量': 用12个月滚动求和的同比作为存量增速代理
                df = ak.macro_china_shrzgm()
                dcol = "月份" if "月份" in df.columns else df.columns[0]
                inc = pd.to_numeric(df.set_index(df[dcol].map(_parse_cn_month))["社会融资规模增量"],
                                    errors="coerce").sort_index()
                roll = inc.rolling(12).sum()
                s = (roll / roll.shift(12) - 1) * 100
            elif fn in ("macro_china_gdzctz", "macro_china_consumer_goods_retail"):
                # 东财月度表: 月份 + 同比增长
                df = getattr(ak, fn)()
                s = df.set_index(df["月份"].map(_parse_cn_month))[column or "同比增长"]
            elif fn == "stock_zh_index_daily":
                df = ak.stock_zh_index_daily(symbol=code)
                s = df.set_index("date")["close"]
            elif fn == "fund_etf_hist_em":
                df = ak.fund_etf_hist_em(symbol=code, period="daily", adjust="qfq")
                s = df.set_index("日期")["收盘"]
            elif fn == "futures_main_sina":
                df = ak.futures_main_sina(symbol=code)
                dcol = "日期" if "日期" in df.columns else df.columns[0]
                s = df.set_index(dcol)[_pick_value_col(df, dcol, "收盘价")]
            elif fn == "macro_cons_gold":
                df = ak.macro_cons_gold()
                s = df.set_index(pd.to_datetime(df["日期"], errors="coerce"))[column or "总库存"]
            elif fn == "macro_usa_cftc_c_holding":
                df = ak.macro_usa_cftc_c_holding()
                vcol = next((c for c in df.columns if code and str(code) in str(c)), df.columns[-1])
                s = df.set_index(pd.to_datetime(df["日期"], errors="coerce"))[vcol]
            elif fn == "macro_usa_rig_count":
                df = ak.macro_usa_rig_count()
                vcol = next((c for c in df.columns if code and str(code) in str(c)), df.columns[1])
                s = df.set_index(pd.to_datetime(df["日期"], errors="coerce"))[vcol]
            elif fn == "macro_cons_opec_month":
                df = ak.macro_cons_opec_month()
                vcol = next((c for c in df.columns if code and str(code) in str(c)), df.columns[-1])
                s = df.set_index(pd.to_datetime(df["日期"], errors="coerce"))[vcol]
            elif fn == "macro_china_central_bank_balance":
                df = ak.macro_china_central_bank_balance()
                dcol = df.columns[0]
                idx = pd.to_datetime(df[dcol].astype(str).str.replace("年", "-").str.replace("月", ""), errors="coerce")
                if idx.isna().all():
                    idx = df[dcol].map(_parse_cn_month)
                vcol = next((c for c in df.columns if "总资产" in str(c)), df.columns[1])
                s = df.set_index(idx)[vcol]
            elif fn == "macro_shipping_bdi":
                df = ak.macro_shipping_bdi()
                dcol = next((c for c in df.columns if "日期" in str(c) or "date" in str(c).lower()), df.columns[0])
                vcol = next((c for c in df.columns if c != dcol and pd.api.types.is_numeric_dtype(df[c])), df.columns[-1])
                s = df.set_index(pd.to_datetime(df[dcol], errors="coerce"))[vcol]
            elif fn == "stock_hk_index_daily_sina":
                df = ak.stock_hk_index_daily_sina(symbol=code)
                s = df.set_index(pd.to_datetime(df["date"], errors="coerce"))["close"]
            elif fn == "bond_china_yield":
                # 中债国债收益率曲线: code为期限列(如 "1年")
                df = ak.bond_china_yield(
                    start_date=(TODAY - dt.timedelta(days=days)).strftime("%Y%m%d"),
                    end_date=TODAY.strftime("%Y%m%d"))
                if "曲线名称" in df.columns:
                    df = df[df["曲线名称"].str.contains("国债", na=False)]
                dcol = next(c for c in df.columns if "日期" in str(c) or "date" in str(c).lower())
                s = df.set_index(dcol)[code]
            elif fn == "macro_china_shibor_all":
                df = ak.macro_china_shibor_all()
                dcol = next((c for c in df.columns if "日期" in str(c) or "时间" in str(c) or "date" in str(c).lower()), df.columns[0])
                vcol = column if column in df.columns else next(c for c in df.columns if "3" in str(c) and "月" in str(c))
                s = df.set_index(dcol)[vcol]
            elif fn == "futures_inventory_em":
                df = ak.futures_inventory_em(symbol=code)
                s = df.set_index(df["日期"])["库存"]
            elif fn == "article_epu_index":
                df = ak.article_epu_index(symbol=code)
                dcol = df.columns[0]
                s = df.set_index(pd.to_datetime(df[dcol].astype(str), errors="coerce"))[df.columns[-1]]
            elif fn == "macro_china_society_electricity":
                df = ak.macro_china_society_electricity()
                s = df.set_index(df["统计时间"].map(_parse_cn_month))[column or "全社会用电量同比"]
            elif fn == "futures_index_ccidx":
                # 中证商品期货指数 (替代已下线的南华指数接口)
                df = ak.futures_index_ccidx(symbol=code or "中证商品期货指数")
                dcol = next(c for c in df.columns if "日期" in str(c) or "date" in str(c).lower())
                s = df.set_index(dcol)[_pick_value_col(df, dcol)]
            else:
                # 金十系月度宏观 (macro_china_cpi_yearly / macro_china_pmi_yearly /
                # macro_usa_ism_pmi / macro_china_exports_yoy / ...):
                # 固定返回 [商品, 日期, 今值, 预测值, 前值] —— 必须显式取'今值',
                # 否则会把全文本的'商品'列误判为数值列 (首跑空序列崩溃的根因)
                df = getattr(ak, fn)()
                date_col = next(c for c in df.columns
                                if "日期" in str(c) or "时间" in str(c)
                                or "date" in str(c).lower() or "月份" in str(c))
                if "月份" in str(date_col):
                    idx = df[date_col].map(_parse_cn_month)
                else:
                    idx = pd.to_datetime(df[date_col], errors="coerce")
                s = df.set_index(idx)[_pick_value_col(df, date_col, column)]
            break
        except (ConnectionError, OSError) as exc:  # RemoteDisconnected 等瞬时网络错误
            last_exc = exc
            time.sleep(3 * (attempt + 1))
    else:
        raise last_exc

    s.index = pd.to_datetime(s.index, errors="coerce")
    s = s[s.index.notna()]
    out = pd.to_numeric(s, errors="coerce").dropna().sort_index()
    if out.empty:
        raise ValueError(f"{fn} returned no usable rows")
    return out


def fetch_nyfed_acm(cfg: dict, days: int) -> pd.Series:
    df = pd.read_excel(cfg["url"], sheet_name="ACM Daily")
    s = df.set_index(pd.to_datetime(df["DATE"]))[cfg["series"]]
    return pd.to_numeric(s, errors="coerce").dropna()


def fetch_treasury_auctions(days: int, cfg: dict | None = None) -> pd.Series:
    """财政部FiscalData真实拍卖数据。
    transform=rolling_issuance: 滚动发行额(十亿美元), 窗口由 window_days 决定(默认28);
    transform=bid_to_cover:     附息国债投标倍数的近10场滚动均值。"""
    cfg = cfg or {}
    mode = cfg.get("transform", "rolling_issuance")
    fields = "auction_date,offering_amt,bid_to_cover_ratio,security_type"
    url = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
           "v1/accounting/od/auctions_query"
           f"?fields={fields}&filter=auction_date:gte:{(TODAY - dt.timedelta(days=days)).isoformat()}"
           "&page[size]=10000")
    rows = SESSION.get(url, timeout=60).json()["data"]
    df = pd.DataFrame(rows)
    df["auction_date"] = pd.to_datetime(df["auction_date"])
    if mode == "bid_to_cover":
        df["bid_to_cover_ratio"] = pd.to_numeric(df["bid_to_cover_ratio"], errors="coerce")
        df = df[df["security_type"].isin(["Note", "Bond"])].dropna(subset=["bid_to_cover_ratio"])
        daily = df.groupby("auction_date")["bid_to_cover_ratio"].mean().sort_index()
        return daily.rolling(10, min_periods=3).mean().dropna()
    df = df[~df["security_type"].isin(["Bill", "CMB"])]  # 剔除短债滚动, 聚焦附息供给
    df["offering_amt"] = pd.to_numeric(df["offering_amt"], errors="coerce")
    daily = df.groupby("auction_date")["offering_amt"].sum() / 1e9
    win = int(cfg.get("window_days", 28))
    return daily.resample("D").sum().rolling(win).sum().dropna()


def fetch_csv_url(cfg: dict, days: int) -> pd.Series:
    df = pd.read_excel(cfg["url"]) if cfg["url"].endswith((".xls", ".xlsx")) else pd.read_csv(cfg["url"])
    date_col = next((c for c in df.columns if "date" in str(c).lower() or "day" in str(c).lower()), df.columns[0])
    s = df.set_index(pd.to_datetime(df[date_col]))[cfg["column"]]
    return pd.to_numeric(s, errors="coerce").dropna()


# ------------------------------------------------------------------
# 2. Compute —— 统一日频化、变化、分位、z 分
# ------------------------------------------------------------------

def to_daily(s: pd.Series) -> pd.Series:
    idx = pd.bdate_range(s.index.min(), max(s.index.max(), pd.Timestamp(TODAY)))
    return s.reindex(idx).ffill().dropna()


def transform_series(s: pd.Series, cfg: dict) -> pd.Series:
    t = cfg.get("transform", "level")
    if t == "yoy":
        s = (s / s.shift(12) - 1) * 100  # 月度指数同比
    elif t == "mom_diff":
        s = s.diff()
    elif t == "rolling_net_7d":
        s = s.rolling(7, min_periods=1).sum()
    elif t == "mom_pct":
        s = (s / s.shift(1) - 1) * 100
    elif t == "rolling_sum_12m":
        s = s.rolling(12, min_periods=12).sum()
    elif t == "diff_20d":
        s = s - s.shift(20)
    if cfg.get("scale"):
        s = s * cfg["scale"]
    return s.dropna()


def change(s: pd.Series, n: int, unit: str) -> float:
    if len(s) <= n:
        return 0.0
    a, b = s.iloc[-1], s.iloc[-1 - n]
    if unit == "pct":
        return round((a / b - 1) * 100, 2) if b else 0.0
    if unit == "bp":
        return round((a - b) * (100 if abs(a) < 50 else 1), 1)  # %口径×100, 已是bp口径不再放大
    return round(a - b, 2)  # pp / idx


def pct_rank(s: pd.Series, window: int) -> int:
    w = s.iloc[-window:] if len(s) > window else s
    return int(round((w <= s.iloc[-1]).mean() * 100))


def zscore_20d_momentum(s: pd.Series) -> float:
    mom = s.pct_change(20) if (s.abs().max() > 30) else s.diff(20)
    m = mom.dropna()
    if len(m) < 60 or m.iloc[-60:].std() == 0:
        return 0.0
    win = m.iloc[-756:] if len(m) > 756 else m
    return float((m.iloc[-1] - win.mean()) / (win.std() + 1e-9))


# ------------------------------------------------------------------
# 3. RULES —— 状态 / 边激活 / 背离判定 (全部阈值集中于此, 可单测)
# ------------------------------------------------------------------

TH = dict(
    extreme_pct_hi=95, extreme_pct_lo=5,      # 水平分位极端
    elevated_pct_hi=85, elevated_pct_lo=15,
    extreme_z=2.0, elevated_z=1.2,            # 20D动量z分
    edge_active_z=1.0,                        # 两端同向动量 → ACTIVE
    div_z=1.0,                                # 对抗型背离动量门槛
    nonresp_leader_z=1.5,                     # 未响应型: 领先端最小动量
    nonresp_follower_z=0.4,                   # 未响应型: 跟随端最大动量
)

# 背离观察清单: (id, 标题, 节点A, 节点B, 预期符号 +1同向/-1反向, 预期关系描述, 实际口径)
DIVERGENCE_WATCHLIST = [
    ("d1", "美债收益率上行 vs 美元走弱", "us10y", "dxy", +1,
     "利差逻辑下, 美债收益率上行应支撑美元同步走强。",
     ["财政供给与期限溢价主导, 而非增长/政策利差", "海外资金对美债的边际需求转弱"]),
    ("d2", "实际利率上行 vs 黄金上涨", "us10yreal", "gold", -1,
     "实际利率是黄金的机会成本, 实际利率快速上行时黄金通常承压下跌。",
     ["财政信用对冲需求压倒利率定价", "央行购金等非价格敏感型买盘"]),
    ("d3", "股票下跌 vs 信用利差不扩", "spx", "hyspread", -1,
     "风险资产普跌时, 高收益利差通常同步走扩定价违约风险。",
     ["下跌主因是估值/久期压缩, 而非衰退与违约定价"]),
    ("d4", "原油上涨 vs 盈亏平衡通胀不动", "oil", "us10ybe", +1,
     "油价上行通常推升市场通胀补偿(盈亏平衡)。",
     ["市场认为油价驱动来自供给暂时因素, 不改变通胀趋势"]),
    ("d5", "成长/价值风格剧烈分化", "growthidx", "valueidx", +1,
     "多数时期成长与价值同涨同跌, 仅相对强弱不同。",
     ["利率久期冲击下的风格再定价"]),
    ("d6", "地缘风险升级 vs 黄金避险买盘缺席", "geopolitics", "gold", +1,
     "重大地缘风险升级时, 避险买盘通常推升金价。",
     ["加息预期与实际利率主导定价, 机会成本压倒避险需求", "高位多头获利了结与保证金抛售", "美元走强分流避险资金"]),
    ("d7", "中国出口强劲 vs 制造业PMI走弱", "exports", "cnpmi", +1,
     "出口高景气通常带动制造业新订单与PMI回升。",
     ["外需与内需分化, PMI受内需与成本端拖累", "出口结构集中于少数高景气行业(AI/新能源)"]),
]


def node_status(pct: int, z: float) -> str:
    if pct >= TH["extreme_pct_hi"] or pct <= TH["extreme_pct_lo"] or abs(z) >= TH["extreme_z"]:
        return "EXTREME"
    if pct >= TH["elevated_pct_hi"] or pct <= TH["elevated_pct_lo"] or abs(z) >= TH["elevated_z"]:
        return "ELEVATED"
    return "NORMAL"


def edge_status(e: dict, z: dict) -> str:
    zs, zt = z.get(e["source"], 0.0), z.get(e["target"], 0.0)
    if abs(zs) < TH["edge_active_z"] or abs(zt) < TH["edge_active_z"]:
        return "INACTIVE"
    sign = 1 if e["relation"] == "positive" else (-1 if e["relation"] == "negative" else 0)
    if sign == 0:  # conditional: 只标记活跃, 不判背离
        return "ACTIVE"
    consistent = (zs * zt * sign) > 0
    if consistent:
        return "ACTIVE"
    # 两端都强动量但方向违背传导关系 → 该边背离; 极强且持续(简化: |z|>1.8)视作失效候选
    if abs(zs) > 1.8 and abs(zt) > 1.8:
        return "INVALIDATED"
    return "DIVERGENCE"



# 标准传导路径 A-H: 每次运行用真实动量评估激活状态
STANDARD_PATHS = [
    ("p_std_a", "路径A · 美国政策转鹰", ["uscpi", "cutsexp", "us2y", "us10y", "us10yreal", "dxy"],
     ["e_cpi_cuts", "e_cuts_2y", "e_2y_10y", "e_10y_real", "e_real_dxy"],
     [("us10yreal", 1), ("dxy", 1), ("cutsexp", -1)], "反向: 政策转鸽交易"),
    ("p_std_b", "路径B · 财政供给与期限溢价", ["usdeficit", "netissue", "auctiontail", "termprem", "us10y", "us10yreal", "ndx"],
     ["e_deficit_netissue", "e_netissue_tail", "e_tail_tp", "e_tp_10y", "e_10y_real", "e_real_ndx"],
     [("termprem", 1), ("netissue", 1)], "反向: 供给压力缓解"),
    ("p_std_c", "路径C · 中国信用扩张", ["tsf", "creditimpulse", "cnpminew", "inddemand", "copper"],
     ["e_tsf_impulse", "e_impulse_pminew", "e_neworder_dem", "e_dem_copper"],
     [("creditimpulse", 1), ("copper", 1)], "反向: 信用收缩"),
    ("p_std_d", "路径D · 全球流动性改善", ["fedbs", "reserves", "usfci", "hyspread", "spx"],
     ["e_fedbs_reserves", "e_reserves_fci", "e_fci_hy2", "e_spx_hy"],
     [("reserves", 1), ("hyspread", -1)], "反向: 流动性收紧"),
    ("p_std_e", "路径E · 流动性冲击", ["liqcrisis", "dxy", "hyspread", "spx"],
     ["e_liqc_dxy", "e_dxy_hyspread", "e_spx_hy"],
     [("dxy", 1), ("hyspread", 1), ("spx", -1)], "反向: 风险偏好修复"),
    ("p_std_f", "路径F · 全球再通胀", ["ismneworder", "oil", "us10ybe", "us10y", "bankidx"],
     ["e_ismno_oil", "e_oil_be", "e_be_10y", "e_10y_bank"],
     [("us10ybe", 1), ("oil", 1)], "反向: 通缩交易"),
    ("p_std_g", "路径G · 中国地产下行", ["propsales", "reinvest", "ironore", "cnppi"],
     ["e_propsales_reinvest", "e_reinvest_ironore", "e_ironore_cnppi"],
     [("propsales", -1), ("ironore", -1)], "反向: 地产企稳"),
    ("p_std_h", "路径H · 风险衰退", ["nfp", "gdpnow", "hyspread", "spx"],
     ["e_nfp_gdpnow", "e_gdpnow_hy", "e_spx_hy"],
     [("hyspread", 1), ("spx", -1)], "反向: 软着陆交易"),
]


def evaluate_standard_paths(z: dict, edge_map: dict, nmap: dict) -> list[dict]:
    """按链上各边的动量一致性评估标准路径: 一致边占比≥60%且平均强度≥1.0 → ACTIVE;
    ≥35% → PARTIAL; 否则 INACTIVE。conditional 关系的边不参与打分。"""
    out = []
    for pid, name, node_ids, edge_ids, anchors, rev_label in STANDARD_PATHS:
        scored = consistent = 0
        zsum = 0.0
        detail = []
        for eid in edge_ids:
            e = edge_map.get(eid)
            if not e or e.get("relation") == "conditional":
                continue
            sgn = 1 if e["relation"] == "positive" else -1
            za, zb = z.get(e["source"], 0.0), z.get(e["target"], 0.0)
            scored += 1
            ok = abs(za) >= 0.8 and abs(zb) >= 0.8 and (za * zb * sgn) > 0
            consistent += ok
            zsum += min(abs(za), abs(zb))
            detail.append(f"{e['source']}→{e['target']}{'✓' if ok else '×'}")
        ratio = consistent / scored if scored else 0.0
        avgz = zsum / scored if scored else 0.0
        status = "ACTIVE" if (ratio >= 0.6 and avgz >= 1.0) else ("PARTIAL" if ratio >= 0.35 else "INACTIVE")
        # 方向锚定: 链条激活但锚定节点动量与命名叙事相反 → 标注反向运行
        dirscore = sum(z.get(n, 0.0) * sg for n, sg in anchors) / max(len(anchors), 1)
        disp = name
        if status != "INACTIVE" and dirscore <= -0.4:
            disp = f"{name} ({rev_label})"
        elif status != "INACTIVE" and abs(dirscore) < 0.4:
            disp = f"{name} (方向不明)"
        out.append(dict(
            id=pid, name=disp, title=disp,
            nodeIds=[n for n in node_ids if n in nmap], edgeIds=edge_ids,
            status=status, consistency=round(ratio, 2),
            note=f"实时评估: {consistent}/{scored} 条边动量一致 ({', '.join(detail)})。"))
    return out


def detect_divergences(z: dict, series: dict, edge_map: dict | None = None, nmap: dict | None = None) -> list[dict]:
    """两类背离:
    1. 对抗型: 两端都有强动量 (|z|≥div_z) 且方向违背预期关系;
    2. 未响应型: 领先端动量极强 (|z|≥1.5) 而跟随端几乎不动 (|z|≤0.4) ——
       例如油价暴涨而盈亏平衡不动、地缘极端而黄金无避险买盘。"""
    out = []
    for did, title, a, b, sign, expected, alts in DIVERGENCE_WATCHLIST:
        za, zb = z.get(a, 0.0), z.get(b, 0.0)
        mode = None
        if abs(za) >= TH["div_z"] and abs(zb) >= TH["div_z"] and (za * zb * sign) < 0:
            mode = "对抗型"
            strength = "HIGH" if min(abs(za), abs(zb)) > 1.8 else ("MEDIUM" if min(abs(za), abs(zb)) > 1.3 else "LOW")
            observed = f"{a} 20D动量z={za:+.1f}, {b} 20D动量z={zb:+.1f}, 方向与预期关系相反。"
        elif max(abs(za), abs(zb)) >= 1.5 and min(abs(za), abs(zb)) >= 0.5 and (za * zb * sign) < 0:
            mode = "对抗型·弱端确认"
            strength = "MEDIUM" if min(abs(za), abs(zb)) >= 0.8 else "LOW"
            observed = f"{a} z={za:+.1f} 与 {b} z={zb:+.1f} 方向违背预期关系 (一端强趋势, 另一端初步反向)。"
        elif abs(za) >= TH["nonresp_leader_z"] and abs(zb) <= TH["nonresp_follower_z"]:
            mode = "未响应型"
            strength = "HIGH" if abs(za) > 2.2 else "MEDIUM"
            observed = f"{a} 20D动量z={za:+.1f} 处于强趋势, {b} 却几乎未响应 (z={zb:+.1f})。"
        if mode is None:
            continue
        # 持续性: 5日前是否已是同类状态
        persistent = False
        try:
            za5 = zscore_20d_momentum(series[a].iloc[:-5])
            zb5 = zscore_20d_momentum(series[b].iloc[:-5])
            if mode == "对抗型":
                persistent = (za5 * zb5 * sign) < 0 and abs(za5) > 0.8 and abs(zb5) > 0.8
            else:
                persistent = abs(za5) > 1.2 and abs(zb5) < 0.6
        except Exception:
            pass
        out.append(dict(
            id=did, title=f"{title}({mode})", relatedNodeIds=[a, b], relatedEdgeIds=[],
            expectedRelation=expected,
            observedRelation=observed,
            window="20D", strength=strength,
            persistence="PERSISTENT" if persistent else "TRANSIENT",
            alternativeExplanations=alts,
            invalidationRisk="HIGH" if strength == "HIGH" and persistent else ("MEDIUM" if strength != "LOW" else "LOW"),
        ))
    # ---- 全边扫描: 观察清单之外, 任何强边两端强动量且方向违背 → 自动背离 ----
    if edge_map and nmap:
        seen_pairs = {frozenset((d["relatedNodeIds"][0], d["relatedNodeIds"][1])) for d in out}
        cands = []
        for e in edge_map.values():
            if e.get("relation") == "conditional" or e.get("strength", 0) < 0.6:
                continue
            sgn = 1 if e["relation"] == "positive" else -1
            za, zb = z.get(e["source"], 0.0), z.get(e["target"], 0.0)
            if abs(za) >= 1.2 and abs(zb) >= 1.2 and (za * zb * sgn) < 0 and frozenset((e["source"], e["target"])) not in seen_pairs:
                cands.append((min(abs(za), abs(zb)), e, za, zb))
        for k, (mz, e, za, zb) in enumerate(sorted(cands, reverse=True)[:5]):
            na, nb = nmap.get(e["source"], {}).get("name", e["source"]), nmap.get(e["target"], {}).get("name", e["target"])
            out.append(dict(
                id=f"d_auto_{k+1}", title=f"{na} 与 {nb} 走势背离(边扫描)",
                relatedNodeIds=[e["source"], e["target"]], relatedEdgeIds=[e["id"]],
                expectedRelation=f"预期{'同向' if e['relation']=='positive' else '反向'}: {e.get('mechanism','')}",
                observedRelation=f"{na} z={za:+.1f}, {nb} z={zb:+.1f}, 与预期关系相反。",
                window="20D", strength="HIGH" if mz > 1.8 else "MEDIUM",
                persistence="TRANSIENT",
                alternativePaths=[], invalidationRisk="MEDIUM"))

    return out


# ------------------------------------------------------------------
# 4. Derived nodes —— 解析 registry 中 formula 字段
# ------------------------------------------------------------------

def eval_derived(formula: str, z: dict) -> float:
    """支持: a*z20(node) ± ... ; z60(spread(X,Y)) 由 extra_fred 在主流程单独处理。"""
    import re as _re
    val, expr = 0.0, formula.replace(" ", "")
    for m in _re.finditer(r"([+-]?[\d.]+)\*z20\((\w+)\)", expr):
        val += float(m[1]) * z.get(m[2], 0.0)
    return round(val, 2)


# ------------------------------------------------------------------
# 5. Main
# ------------------------------------------------------------------

def _fmt_change(n: dict) -> str:
    """5D变化的展示单位: 利率类→bp, 同比类→pp, 其余→%。"""
    v = n["change5d"]
    u = n.get("unit", "")
    if u == "%":
        return f"{v * 100:+.0f}bp" if abs(v) < 3 else f"{v:+.0f}bp"
    if u == "%YoY":
        return f"{v:+.1f}pp"
    return f"{v:+.1f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parent / "output"))
    ap.add_argument("--cache", default=str(HERE.parent / "output" / "nodes.json"))
    args = ap.parse_args()
    outdir = Path(args.out); outdir.mkdir(parents=True, exist_ok=True)

    reg = yaml.safe_load(open(HERE / "data_registry.yaml"))
    meta = yaml.safe_load(open(HERE / "nodes_meta.yaml"))["nodes"]
    edges = yaml.safe_load(open(HERE / "edges.yaml"))["edges"]
    days = reg["defaults"]["history_days"]
    pwin = reg["defaults"]["percentile_window"]

    prev = {}
    if Path(args.cache).exists():  # 上次成功值, 用于失败回退
        prev = {n["id"]: n for n in json.load(open(args.cache))}

    series: dict[str, pd.Series] = {}
    stale: list[str] = []
    err_map: dict[str, str] = {}   # nid -> 错误原文 (写入 data_status 便于远程诊断)

    # ---- 第一遍: 拉取所有非派生节点 ----
    for nid, cfg in reg["nodes"].items():
        src = cfg["source"]
        if src in ("derived", "manual", "alias"):
            continue
        try:
            if src == "fred":
                s = fetch_fred(cfg["series"], days)
            elif src == "yahoo":
                s = fetch_yahoo(cfg["ticker"], days)
            elif src == "akshare":
                s = fetch_akshare(cfg, days)
            elif src == "nyfed_acm":
                s = fetch_nyfed_acm(cfg, days)
            elif src == "treasury":
                s = fetch_treasury_auctions(days, cfg)
            elif src == "csv_url":
                s = fetch_csv_url(cfg, days)
            else:
                raise ValueError(f"unknown source {src}")
            cleaned = to_daily(transform_series(s, cfg))
            if cleaned.empty:
                raise ValueError("empty series after transform (insufficient history?)")
            sanity_check(nid, cleaned)
            series[nid] = cleaned
            time.sleep(0.55)  # FRED 120/min 限制: 44个序列必须 ≥0.5s 间隔
        except Exception as exc:
            print(f"[WARN] {nid} fetch failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            err_map[nid] = f"{type(exc).__name__}: {str(exc)[:160]}"
            stale.append(nid)
            time.sleep(1.0)  # 失败也休眠, 防止限流雪崩

    # debtceiling 的 spread 特例
    try:
        a, b = fetch_fred("DTB4WK", days), fetch_fred("DTB3", days)
        series["_dc_spread"] = to_daily((a - b).dropna())
    except Exception:
        pass

    # ---- 别名源: 直接复用其他节点的真实序列 (cdxig/cdxhy 等代理) ----
    for nid, cfg in reg["nodes"].items():
        if cfg["source"] == "alias" and cfg["of"] in series:
            try:
                sanity_check(nid, series[cfg["of"]])
                series[nid] = series[cfg["of"]].copy()
            except ValueError as exc:
                err_map[nid] = str(exc)[:160]
                stale.append(nid)

    # ---- series: 真实派生 (两条真实序列的算术组合, 如中美利差/隐含降息次数) ----
    import re as _re
    for nid, cfg in reg["nodes"].items():
        if cfg["source"] != "derived":
            continue
        f = str(cfg.get("formula", ""))
        m = _re.match(r"series:\(?(\w+)-(\w+)\)?(?:/([\d.]+))?$", f.replace(" ", ""))
        if m and m[1] in series and m[2] in series:
            a, b = series[m[1]].align(series[m[2]], join="inner")
            out = (a - b) / (float(m[3]) if m[3] else 1.0)
            if not out.empty:
                try:
                    sanity_check(nid, out.dropna())
                    series[nid] = out.dropna()
                except ValueError as exc:
                    err_map[nid] = str(exc)[:160]
                    stale.append(nid)

    z = {nid: zscore_20d_momentum(s) for nid, s in series.items() if not nid.startswith("_")}

    # ---- 第二遍: 派生与手工节点 ----
    nodes_out = []
    for nid, cfg in reg["nodes"].items():
        m = meta[nid]
        unit_ch = cfg.get("unit_changes", "pct")
        if nid in series and len(series[nid]) > 0 and cfg["source"] in ("derived", "alias"):
            # alias / series派生节点拥有完整真实序列, 与普通节点同等处理
            s = series[nid]
            node = dict(
                value=round(float(s.iloc[-1]), 2 if abs(s.iloc[-1]) < 1000 else 0),
                change1d=change(s, 1, unit_ch), change5d=change(s, 5, unit_ch),
                change20d=change(s, 20, unit_ch), change60d=change(s, 60, unit_ch),
                percentile=pct_rank(s, pwin))
            z.setdefault(nid, zscore_20d_momentum(s))
        elif cfg["source"] == "derived":
            if nid == "debtceiling" and "_dc_spread" in series:
                zz = zscore_20d_momentum(series["_dc_spread"]); value = round(zz, 2)
            else:
                zz = eval_derived(cfg["formula"], z); value = zz
            z[nid] = zz
            node = dict(value=value, change1d=0.0, change5d=round(zz * 0.3, 2),
                        change20d=round(zz, 2), change60d=round(zz * 1.2, 2),
                        percentile=int(np.clip(50 + zz * 20, 1, 99)))
        elif cfg["source"] == "manual":
            node = dict(value=cfg["value"], change1d=0.0, change5d=0.0,
                        change20d=0.0, change60d=0.0, percentile=50)
            z[nid] = 0.0
        elif nid in series and len(series[nid]) > 0:
            s = series[nid]
            node = dict(
                value=round(float(s.iloc[-1]), 2 if abs(s.iloc[-1]) < 1000 else 0),
                change1d=change(s, 1, unit_ch), change5d=change(s, 5, unit_ch),
                change20d=change(s, 20, unit_ch), change60d=change(s, 60, unit_ch),
                percentile=pct_rank(s, pwin))
        else:  # 失败回退
            p = prev.get(nid, {})
            node = dict(value=p.get("value", 0), change1d=p.get("change1d", 0),
                        change5d=p.get("change5d", 0), change20d=p.get("change20d", 0),
                        change60d=p.get("change60d", 0), percentile=p.get("percentile", 50))
            z.setdefault(nid, 0.0)
        node.update(id=nid, name=m["name"], category=m["category"], priority=m["priority"],
                    unit=m.get("unit", ""), description=m["description"],
                    status=node_status(node["percentile"], z.get(nid, 0.0)),
                    stale=nid in stale)
        # 数据质量标记: live(真实) / derived(派生·代理) / manual(手工) / stale(未取到)
        if cfg["source"] == "manual":
            node["quality"] = "manual"
        elif nid in series and len(series[nid]) > 0:
            node["quality"] = "derived" if cfg["source"] in ("derived", "alias") else "live"
        elif cfg["source"] in ("derived", "alias"):
            node["quality"] = "derived" if z.get(nid) not in (None, 0.0) or nid == "debtceiling" else "stale"
        else:
            node["quality"] = "stale"
        if "invalidation" in m:
            node["invalidation"] = m["invalidation"]
        # 历史序列 (前端迷你图): 最近60个交易日
        if nid in series:
            tail = series[nid].iloc[-60:]
            node["history"] = [{"date": d.strftime("%m-%d"), "value": round(float(v), 3)}
                               for d, v in tail.items()]
        nodes_out.append(node)

    # ---- 边状态 / 背离 / 失效 ----
    edges_out = []
    for e in edges:
        st = edge_status(e, z)
        edges_out.append({**e, "status": st})
    edge_map = {e["id"]: e for e in edges_out}
    nmap = {n["id"]: n for n in nodes_out}
    divs = detect_divergences(z, series, edge_map, nmap)
    # 把背离涉及的边和节点同步标记
    div_pairs = {frozenset(d["relatedNodeIds"]) for d in divs}
    for e in edges_out:
        if frozenset((e["source"], e["target"])) in div_pairs and e["status"] != "INVALIDATED":
            e["status"] = "DIVERGENCE"
    for d in divs:
        d["relatedEdgeIds"] = [e["id"] for e in edges_out
                               if frozenset((e["source"], e["target"])) == frozenset(d["relatedNodeIds"])]
        for nid in d["relatedNodeIds"]:
            if nmap[nid]["status"] in ("NORMAL", "ELEVATED"):
                nmap[nid]["status"] = "DIVERGENCE"
    for e in edges_out:
        if e["status"] == "INVALIDATED":
            for nid in (e["source"], e["target"]):
                pass  # 节点不直接因边失效降级, 由人工复核

    # ---- 激活路径: ACTIVE 边的连通链 (按strength取前3条最长链, 简化贪心) ----
    active = [e for e in edges_out if e["status"] == "ACTIVE"]
    adj = {}
    for e in active:
        adj.setdefault(e["source"], []).append(e)
    paths, used = [], set()
    for e in sorted(active, key=lambda x: -x["strength"]):
        if e["id"] in used:
            continue
        chain, node_chain, cur = [e], [e["source"], e["target"]], e["target"]
        used.add(e["id"])
        while True:
            nxt = [x for x in adj.get(cur, []) if x["id"] not in used]
            if not nxt:
                break
            x = max(nxt, key=lambda y: y["strength"])
            chain.append(x); used.add(x["id"]); node_chain.append(x["target"]); cur = x["target"]
        if len(chain) >= 1:
            paths.append(dict(
                id=f"p_auto_{len(paths)+1}",
                title=" → ".join(nmap[n]["name"] for n in node_chain),
                nodeIds=node_chain, edgeIds=[c["id"] for c in chain],
                note="由规则引擎根据20日动量一致性自动识别的激活传导链。"))
        if len(paths) == 3:
            break
    std_paths = evaluate_standard_paths(z, edge_map, nmap)
    # 排序: ACTIVE标准路径 > 自动链 > PARTIAL > INACTIVE(仍输出, 前端按节点等级过滤展示)
    rank = {"ACTIVE": 0, "PARTIAL": 2, "INACTIVE": 3}
    paths = sorted(std_paths, key=lambda p: rank[p["status"]] * 10 - p["consistency"]) + paths
    paths = [p for p in paths if p.get("status") != "INACTIVE" or True]  # 全量输出, 展示端过滤

    # ---- Market State ----
    movers = sorted((n for n in nodes_out if n["priority"] in ("P0", "P1") and "history" in n),
                    key=lambda n: -abs(z.get(n["id"], 0)))
    top = movers[0] if movers else nodes_out[0]
    high_risk = sum(
        (n["status"] == "EXTREME" and n["priority"] in ("P0", "P1"))
        or n["status"] in ("DIVERGENCE", "INVALIDATED")
        for n in nodes_out)
    regime = "EXTREME" if high_risk >= 8 else ("ELEVATED" if high_risk >= 3 else "NORMAL")
    manual_ids = [nid for nid, cfg in reg["nodes"].items() if cfg["source"] == "manual"]
    proxy_ids = [nid for nid, cfg in reg["nodes"].items()
                 if cfg["source"] == "alias" or (cfg["source"] == "derived" and "代理" in str(cfg.get("note", "")))]
    # 每个数据源家族保留一条错误样本, 远程读 market_state.json 即可诊断
    src_errors: dict[str, str] = {}
    for nid, msg in err_map.items():
        fam = reg["nodes"][nid]["source"]
        if fam == "akshare":
            fam = f"akshare:{reg['nodes'][nid].get('fn', '')}"
        elif fam == "fred":
            fam = "fred"
        src_errors.setdefault(fam, f"{nid} → {msg}")
    data_status = dict(
        stale=sorted(stale), manual=sorted(manual_ids), proxy=sorted(proxy_ids),
        liveCount=len(reg["nodes"]) - len(stale) - len(manual_ids),
        totalCount=len(reg["nodes"]),
        sourceErrors=src_errors)

    market_state = dict(
        data_status=data_status,
        topMover=dict(nodeId=top["id"],
                      text=f"{top['name']} {_fmt_change(top)}/5D · {top['percentile']}分位"),
        dominantPathId=next((p["id"] for p in paths if p.get("status") == "ACTIVE"), paths[0]["id"] if paths else ""),
        divergenceCount=len(divs), highRiskCount=high_risk, regime=regime,
        regimeNote=f"自动识别: {len(divs)}条背离, {high_risk}个高风险节点。"
                   + ("背离集中指向供给/久期因素而非政策预期, 建议人工复核主导逻辑。" if len(divs) >= 3 else ""),
        updatedAt=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))

    # ---- 写出 ----
    # ---- 今日变化: 与上一次输出对比 (回访核心) ----
    changes = dict(since="", generatedAt=market_state.get("updatedAt", ""),
                   nodeChanges=[], pathChanges=[], divAdded=[], divRemoved=[])
    try:
        prev_nodes = {n["id"]: n for n in json.load(open(outdir / "nodes.json", encoding="utf-8"))}
        try:
            changes["since"] = json.load(open(outdir / "market_state.json", encoding="utf-8")).get("updatedAt", "")
        except Exception:
            pass
        sev = {"NORMAL": 0, "ELEVATED": 1, "DIVERGENCE": 2, "INVALIDATED": 2, "EXTREME": 3}
        ncs = []
        for n in nodes_out:
            pv = prev_nodes.get(n["id"])
            if pv and pv.get("status") != n["status"] and not n.get("stale"):
                ncs.append(dict(id=n["id"], name=n["name"], frm=pv["status"], to=n["status"],
                                delta=abs(sev.get(n["status"], 0) - sev.get(pv.get("status"), 0)),
                                pri=n["priority"]))
        ncs.sort(key=lambda c: (-c["delta"], c["pri"]))
        changes["nodeChanges"] = [{"id": c["id"], "name": c["name"], "from": c["frm"], "to": c["to"]} for c in ncs[:30]]
        try:
            prev_paths = {p["id"]: p for p in json.load(open(outdir / "paths.json", encoding="utf-8"))}
            for p in paths:
                if p["id"].startswith("p_std_"):
                    ps = prev_paths.get(p["id"], {}).get("status")
                    if ps and ps != p.get("status"):
                        changes["pathChanges"].append(f'{p.get("title") or p.get("name")}: {ps} → {p["status"]}')
        except Exception:
            pass
        try:
            prev_divs = {d.get("title") for d in json.load(open(outdir / "divergences.json", encoding="utf-8"))}
            cur_divs = {d.get("title") for d in divs}
            changes["divAdded"] = sorted(cur_divs - prev_divs)[:8]
            changes["divRemoved"] = sorted(prev_divs - cur_divs)[:8]
        except Exception:
            pass
    except Exception:
        pass  # 首次运行无历史文件, changes 为空

    dump = lambda name, obj: json.dump(obj, open(outdir / name, "w"), ensure_ascii=False, indent=1)
    dump("changes.json", changes)
    dump("nodes.json", nodes_out)
    dump("edges.json", edges_out)
    dump("paths.json", paths)
    dump("divergences.json", divs)
    dump("market_state.json", market_state)
    print(f"OK: {len(nodes_out)} nodes ({len(stale)} stale), {len(edges_out)} edges, "
          f"{len(divs)} divergences, {len(paths)} paths → {outdir}")


if __name__ == "__main__":
    main()
