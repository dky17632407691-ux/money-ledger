"""持仓净值每日更新服务。

数据源：
  - A股 / 港股 / 美股：腾讯行情（一次请求可批量）
  - 场外基金净值：天天基金历史净值接口（官方公布口径）
  - 汇率：新浪财经外汇接口

用法：
  python tracker.py            # 抓取并落库，打印当日快照
  python tracker.py --init     # 初始化数据库
"""

import json
import re
import ssl
import sqlite3
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "data" / "portfolio.db"
CONFIG_PATH = BASE / "config.json"

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

CURRENCY = {"a": "CNY", "hk": "HKD", "us": "USD", "fund": "CNY"}
TYPE_LABEL = {"a": "A股", "hk": "港股", "us": "美股", "fund": "基金"}

QUOTE_RE = re.compile(r'v_([A-Za-z0-9]+)="([^"]*)"')
FX_RE = re.compile(r'hq_str_(\w+)="([^"]*)"')


# ---------------------------------------------------------------- HTTP

def http_get(url, headers=None, timeout=15):
    h = dict(UA)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


# ---------------------------------------------------------------- 抓取

def to_symbol(code, kind):
    """把标的代码转成行情接口的 symbol。"""
    code = str(code).strip()
    if kind == "a":
        head = code[0]
        if head in "69":
            return "sh" + code
        if head in "03":
            return "sz" + code
        if head in "48":
            return "bj" + code
    if kind == "hk":
        return "hk" + code.zfill(5)
    if kind == "us":
        return "us" + code.upper()
    raise ValueError(f"未知类型: {kind}")


def parse_quote_date(raw):
    """腾讯行情的时间字段在三种市场格式不一致，统一解析成 YYYY-MM-DD。"""
    raw = (raw or "").strip()
    if re.fullmatch(r"\d{14}", raw):
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    m = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def fetch_stock_quotes(items):
    """批量拉取股票行情，返回 {code: {...}}。"""
    symbols = {to_symbol(i["code"], i["type"]): i for i in items if i["type"] != "fund"}
    if not symbols:
        return {}
    url = "https://qt.gtimg.cn/q=" + ",".join(symbols.keys())
    body = http_get(url).decode("gbk", errors="replace")

    out = {}
    for sym, val in QUOTE_RE.findall(body):
        f = val.split("~")
        if len(f) < 6:
            continue
        item = symbols.get(sym)
        if not item:
            continue
        try:
            price = float(f[3])
            prev = float(f[4])
        except (ValueError, IndexError):
            continue
        if price <= 0:
            continue
        out[item["code"]] = {
            "name": f[1],
            "price": price,
            "prev_close": prev,
            "change_pct": round((price - prev) / prev * 100, 4) if prev else 0.0,
            "quote_date": parse_quote_date(f[30] if len(f) > 30 else ""),
            "currency": CURRENCY[item["type"]],
            "source": "tencent",
        }
    return out


def fetch_fund_nav(code):
    """取单只场外基金最新公布的净值。"""
    url = (
        f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}"
        "&pageIndex=1&pageSize=1"
    )
    body = http_get(url, {"Referer": "https://fundf10.eastmoney.com/"}).decode("utf-8")
    data = json.loads(body)
    rows = (data.get("Data") or {}).get("LSJZList") or []
    if not rows:
        return None
    r = rows[0]
    nav = float(r["DWJZ"])
    pct = r.get("JZZZL")
    return {
        "name": r.get("SHORTNAME") or "",
        "price": nav,
        "prev_close": None,
        "change_pct": float(pct) if pct not in ("", None) else 0.0,
        "quote_date": r["FSRQ"],
        "cum_nav": float(r["LJJZ"]) if r.get("LJJZ") else None,
        "currency": "CNY",
        "source": "eastmoney",
    }


def fetch_fx():
    """取港币、美元兑人民币汇率。"""
    url = "https://hq.sinajs.cn/list=fx_shkdcny,fx_susdcny"
    body = http_get(url, {"Referer": "https://finance.sina.com.cn"}).decode(
        "gbk", errors="replace"
    )
    out = {"CNY": 1.0}
    for key, val in FX_RE.findall(body):
        f = val.split(",")
        if len(f) < 3:
            continue
        try:
            rate = float(f[1])
        except ValueError:
            continue
        if key == "fx_shkdcny" and 0.5 < rate < 1.5:
            out["HKD"] = rate
        elif key == "fx_susdcny" and 5.0 < rate < 9.0:
            out["USD"] = rate
    return out


# ---------------------------------------------------------------- 存储

SCHEMA = """
CREATE TABLE IF NOT EXISTS holdings (
    code TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    shares REAL,
    avg_cost REAL,
    account TEXT,
    currency TEXT
);

CREATE TABLE IF NOT EXISTS price_daily (
    code TEXT,
    trade_date TEXT,
    price REAL,
    prev_close REAL,
    change_pct REAL,
    currency TEXT,
    source TEXT,
    fetched_at TEXT,
    PRIMARY KEY (code, trade_date)
);

CREATE TABLE IF NOT EXISTS fx_daily (
    pair TEXT,
    trade_date TEXT,
    rate REAL,
    PRIMARY KEY (pair, trade_date)
);

CREATE TABLE IF NOT EXISTS snapshot_daily (
    trade_date TEXT PRIMARY KEY,
    market_value REAL,
    cost_value REAL,
    pnl REAL,
    pnl_pct REAL,
    created_at TEXT
);
"""


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def sync_holdings(conn, holdings):
    for h in holdings:
        conn.execute(
            "INSERT INTO holdings (code, name, type, shares, avg_cost, account, currency) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET "
            "name=excluded.name, type=excluded.type, shares=excluded.shares, "
            "avg_cost=excluded.avg_cost, account=excluded.account, currency=excluded.currency",
            (
                h["code"],
                h.get("name", ""),
                h["type"],
                h["shares"],
                h["avg_cost"],
                h.get("account", ""),
                CURRENCY[h["type"]],
            ),
        )
    conn.commit()


def save_quotes(conn, quotes, fetched_at):
    for code, q in quotes.items():
        if not q.get("quote_date"):
            continue
        conn.execute(
            "INSERT INTO price_daily (code, trade_date, price, prev_close, change_pct, "
            "currency, source, fetched_at) VALUES (?,?,?,?,?,?,?,?) "
            "ON CONFLICT(code, trade_date) DO UPDATE SET price=excluded.price, "
            "prev_close=excluded.prev_close, change_pct=excluded.change_pct, "
            "fetched_at=excluded.fetched_at",
            (
                code,
                q["quote_date"],
                q["price"],
                q["prev_close"],
                q["change_pct"],
                q["currency"],
                q["source"],
                fetched_at,
            ),
        )
    conn.commit()


def save_fx(conn, fx, trade_date):
    for cur, rate in fx.items():
        if cur == "CNY":
            continue
        conn.execute(
            "INSERT INTO fx_daily (pair, trade_date, rate) VALUES (?,?,?) "
            "ON CONFLICT(pair, trade_date) DO UPDATE SET rate=excluded.rate",
            (f"{cur}CNY", trade_date, rate),
        )
    conn.commit()


# ---------------------------------------------------------------- 计算

def width(s):
    """中文按 2 字符宽计算，用于终端表格对齐。"""
    return sum(2 if ord(c) > 127 else 1 for c in s)


def pad(s, n, align="left"):
    s = str(s)
    gap = max(0, n - width(s))
    if align == "right":
        return " " * gap + s
    return s + " " * gap


def build_report(holdings, quotes, fx, today, is_weekend=False):
    rows = []
    total_mv = total_cost = total_day = 0.0
    stale = []

    for h in holdings:
        q = quotes.get(h["code"])
        if not q:
            rows.append(
                {
                    "name": h.get("name", h["code"]),
                    "code": h["code"],
                    "type": TYPE_LABEL[h["type"]],
                    "price": None,
                    "pct": 0.0,
                    "mv": 0.0,
                    "cost": 0.0,
                    "pnl": 0.0,
                    "pnl_pct": 0.0,
                    "date": "抓取失败",
                    "stale": True,
                }
            )
            stale.append(h["code"])
            continue

        cur = CURRENCY[h["type"]]
        rate = fx.get(cur, 0.0)
        if rate <= 0:
            rate = 0.0
            stale.append(h["code"] + "(缺汇率)")

        mv = h["shares"] * q["price"] * rate
        cost = h["shares"] * h["avg_cost"] * rate
        pnl = mv - cost
        prev = q["prev_close"]
        if prev is None and q["change_pct"]:
            prev = q["price"] / (1 + q["change_pct"] / 100)
        day_pnl = h["shares"] * (q["price"] - prev) * rate if prev else 0.0
        rows.append(
            {
                "day_pnl": day_pnl,
                "name": h.get("name") or q["name"],
                "code": h["code"],
                "type": TYPE_LABEL[h["type"]],
                "price": q["price"],
                "pct": q["change_pct"],
                "mv": mv,
                "cost": cost,
                "pnl": pnl,
                "pnl_pct": (pnl / cost * 100) if cost else 0.0,
                "date": q["quote_date"],
                "stale": (q["quote_date"] != today) and not is_weekend,
            }
        )
        total_mv += mv
        total_cost += cost
        total_day += day_pnl

    return rows, total_mv, total_cost, total_day, stale


def render(rows, total_mv, total_cost, fx, today):
    print()
    print(f"  资产快照  {today}")
    print(f"  汇率  HKD/CNY {fx.get('HKD', 0):.4f}   USD/CNY {fx.get('USD', 0):.4f}")
    print()
    header = (
        pad("标的", 20) + pad("类型", 6) + pad("现价", 11, "right")
        + pad("日涨跌", 10, "right") + pad("市值(CNY)", 14, "right")
        + pad("浮动盈亏", 14, "right") + pad("收益率", 10, "right") + "  净值日期"
    )
    print(header)
    print("  " + "-" * (width(header) + 1))

    for r in rows:
        if r["price"] is None:
            print(pad(r["name"], 20) + pad(r["type"], 6) + "  ——  抓取失败")
            continue
        price_s = f"{r['price']:.2f}"
        print(
            pad(r["name"][:9], 20)
            + pad(r["type"], 6)
            + pad(price_s, 11, "right")
            + pad(f"{r['pct']:+.2f}%", 10, "right")
            + pad(f"{r['mv']:,.0f}", 14, "right")
            + pad(f"{r['pnl']:+,.0f}", 14, "right")
            + pad(f"{r['pnl_pct']:+.2f}%", 10, "right")
            + ("  " + r["date"] + ("  ← 待更新" if r["stale"] else ""))
        )

    pnl = total_mv - total_cost
    pct = pnl / total_cost * 100 if total_cost else 0
    print("  " + "-" * 100)
    print(
        pad("合计", 20) + pad("", 6) + pad("", 11)
        + pad("", 10) + pad(f"{total_mv:,.0f}", 14, "right")
        + pad(f"{pnl:+,.0f}", 14, "right") + pad(f"{pct:+.2f}%", 10, "right")
    )
    print()


# ---------------------------------------------------------------- 主流程

def main():
    today = datetime.now().strftime("%Y-%m-%d")
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    holdings = cfg["holdings"]

    conn = connect()
    sync_holdings(conn, holdings)

    stocks = [h for h in holdings if h["type"] != "fund"]
    funds = [h for h in holdings if h["type"] == "fund"]

    quotes = {}
    print("抓取股票行情 ...", end=" ", flush=True)
    try:
        quotes.update(fetch_stock_quotes(stocks))
        print(f"{len(quotes)}/{len(stocks)} 成功")
    except Exception as e:
        print(f"失败: {e}")

    print("抓取基金净值 ...", end=" ", flush=True)
    ok = 0
    for f in funds:
        try:
            q = fetch_fund_nav(f["code"])
            if q:
                quotes[f["code"]] = q
                ok += 1
        except Exception:
            pass
    print(f"{ok}/{len(funds)} 成功")

    print("抓取汇率 ...", end=" ", flush=True)
    try:
        fx = fetch_fx()
        print(" ".join(f"{k}={v:.4f}" for k, v in fx.items() if k != "CNY") or "失败")
    except Exception as e:
        fx = {"CNY": 1.0}
        print(f"失败: {e}")

    fetched_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    save_quotes(conn, quotes, fetched_at)
    save_fx(conn, fx, today)

    is_weekend = datetime.now().weekday() >= 5
    rows, total_mv, total_cost, total_day, stale = build_report(
        holdings, quotes, fx, today, is_weekend
    )
    render(rows, total_mv, total_cost, fx, today)

    pnl = total_mv - total_cost
    conn.execute(
        "INSERT INTO snapshot_daily (trade_date, market_value, cost_value, pnl, pnl_pct, created_at) "
        "VALUES (?,?,?,?,?,?) ON CONFLICT(trade_date) DO UPDATE SET "
        "market_value=excluded.market_value, cost_value=excluded.cost_value, "
        "pnl=excluded.pnl, pnl_pct=excluded.pnl_pct",
        (
            today,
            total_mv,
            total_cost,
            pnl,
            (pnl / total_cost * 100) if total_cost else 0,
            fetched_at,
        ),
    )
    conn.commit()

    latest = {
        "as_of": today,
        "fetched_at": fetched_at,
        "fx": fx,
        "total_market_value": total_mv,
        "total_cost": total_cost,
        "total_pnl": pnl,
        "total_pnl_pct": (pnl / total_cost * 100) if total_cost else 0,
        "total_day_pnl": total_day,
        "holdings": rows,
    }
    (BASE / "data" / "latest.json").write_text(
        json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if stale:
        print(f"  待更新标的：{', '.join(stale)}")
        print("  （基金净值晚间陆续公布，未公布属正常，重试后会自动补齐）")
    print(f"  数据已写入 {DB_PATH.relative_to(BASE)}")
    conn.close()
    return 0 if not stale else 0


if __name__ == "__main__":
    sys.exit(main())
