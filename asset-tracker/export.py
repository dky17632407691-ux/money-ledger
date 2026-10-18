"""把最新快照渲染成看板页面（App 资产页的界面原型）。"""

import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
data = json.loads((BASE / "data" / "latest.json").read_text(encoding="utf-8"))


def cls(v):
    return "up" if v > 0 else ("down" if v < 0 else "flat")


def money(v, sign=False):
    body = f"{abs(v):,.0f}"
    if sign:
        pre = "+" if v > 0 else ("-" if v < 0 else "")
        return f"{pre}¥{body}"
    return f"¥{body}"


rows = sorted(data["holdings"], key=lambda r: -r["mv"])
total_mv = data["total_market_value"]

tag_class = {"A股": "ta", "港股": "th", "美股": "tu", "基金": "tf"}

tr_html = []
for r in rows:
    tr_html.append(
        f"""      <tr>
        <td><div class="nm">{r['name']}</div><div class="cd">{r['code']}</div></td>
        <td><span class="tag {tag_class.get(r['type'], 'ta')}">{r['type']}</span></td>
        <td class="num">{r['price']:.2f}</td>
        <td class="num {cls(r['pct'])}">{r['pct']:+.2f}%</td>
        <td class="num strong">{money(r['mv'])}</td>
        <td class="num {cls(r['pnl'])}">{money(r['pnl'], True)}</td>
        <td class="num {cls(r['pnl_pct'])}">{r['pnl_pct']:+.2f}%</td>
        <td class="dt">{r['date']}</td>
      </tr>"""
    )

bar_html = []
for r in rows:
    share = r["mv"] / total_mv * 100 if total_mv else 0
    bar_html.append(
        f"""      <div class="bar-row">
        <div class="bar-head"><span>{r['name']}</span><span class="bar-val">{share:.1f}%</span></div>
        <div class="bar-track"><div class="bar-fill {tag_class.get(r['type'], 'ta')}" style="width:{share:.2f}%"></div></div>
      </div>"""
    )

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #F6F6F3;
  --card: #FFFFFF;
  --line: #E7E5DF;
  --tx: #1C1C1A;
  --tx2: #71706B;
  --tx3: #A3A19B;
  --up: #C4382A;
  --down: #0D8A60;
}
body {
  background: var(--bg);
  color: var(--tx);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: 32px 20px 56px;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1000px; margin: 0 auto; }
header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
.sub { font-size: 12px; color: var(--tx2); line-height: 1.7; }
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
.label { font-size: 12px; color: var(--tx2); margin-bottom: 8px; }
.value { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.value.sm { font-size: 24px; }
.note { font-size: 12px; color: var(--tx3); margin-top: 8px; }
.up { color: var(--up); }
.down { color: var(--down); }
.flat { color: var(--tx2); }
h2 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
.table-card { padding: 18px 20px 8px; margin-bottom: 12px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
th { text-align: right; font-size: 11px; font-weight: 500; color: var(--tx3); padding: 0 0 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:first-child, th:nth-child(2) { text-align: left; }
td { padding: 13px 0; border-bottom: 1px solid #F2F0EB; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.nm { font-size: 13px; font-weight: 500; color: var(--tx); }
.cd { font-size: 11px; color: var(--tx3); margin-top: 3px; font-variant-numeric: tabular-nums; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.num.strong { font-weight: 500; }
.dt { text-align: right; font-size: 11px; color: var(--tx3); white-space: nowrap; padding-left: 12px; }
.tag { display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 5px; line-height: 1.5; }
.ta { background: #FBEAE7; color: #A63222; }
.th { background: #EAF1FB; color: #1F5A9E; }
.tu { background: #EFEBFA; color: #5B44A8; }
.tf { background: #EAF4EC; color: #2C6B3F; }
.bars { margin-top: 4px; }
.bar-row { margin-bottom: 14px; }
.bar-row:last-child { margin-bottom: 0; }
.bar-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--tx2); margin-bottom: 6px; }
.bar-val { font-variant-numeric: tabular-nums; color: var(--tx); }
.bar-track { height: 6px; background: #F0EEE9; border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-fill.ta { background: #C9594A; }
.bar-fill.th { background: #4A78B8; }
.bar-fill.tu { background: #7A66C0; }
.bar-fill.tf { background: #4E8A5F; }
footer { margin-top: 18px; font-size: 11px; color: var(--tx3); line-height: 1.8; }
@media (max-width: 720px) {
  .metrics { grid-template-columns: 1fr; }
  .value { font-size: 24px; }
}
"""

HTML_HEAD = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>资产总览</title>
"""

body = f"""<div class="wrap">
  <header>
    <h1>资产总览</h1>
    <div class="sub">数据截至 {data['as_of']} {data['fetched_at'][11:16]} · 汇率 HKD {data['fx'].get('HKD', 0):.4f} / USD {data['fx'].get('USD', 0):.4f}</div>
  </header>

  <section class="metrics">
    <div class="card">
      <div class="label">总资产（折算人民币）</div>
      <div class="value">{money(total_mv)}</div>
      <div class="note">{len(rows)} 个标的 · A股 / 港股 / 美股 / 场外基金</div>
    </div>
    <div class="card">
      <div class="label">累计浮动盈亏</div>
      <div class="value sm {cls(data['total_pnl'])}">{money(data['total_pnl'], True)}</div>
      <div class="note {cls(data['total_pnl_pct'])}">{data['total_pnl_pct']:+.2f}% · 成本 {money(data['total_cost'])}</div>
    </div>
    <div class="card">
      <div class="label">最近交易日盈亏</div>
      <div class="value sm {cls(data['total_day_pnl'])}">{money(data['total_day_pnl'], True)}</div>
      <div class="note">按最新公布的收盘价与净值计算</div>
    </div>
  </section>

  <section class="card table-card">
    <h2>持仓明细</h2>
    <table>
      <thead>
        <tr>
          <th>标的</th><th>类型</th><th>现价 / 净值</th><th>日涨跌</th>
          <th>市值</th><th>浮动盈亏</th><th>收益率</th><th>数据日期</th>
        </tr>
      </thead>
      <tbody>
{chr(10).join(tr_html)}
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>资产配置</h2>
    <div class="bars">
{chr(10).join(bar_html)}
    </div>
  </section>

  <footer>
    红色表示上涨，绿色表示下跌（A 股习惯）。市值与盈亏均按当日汇率折算为人民币。<br>
    基金净值取自官方公布口径，通常在交易日 20:00 后陆续更新，QDII 基金延后一天。
  </footer>
</div>
"""

out = BASE / "dashboard.html"
out.write_text(HTML_HEAD + "<style>" + CSS + "</style></head><body>" + body + "</body></html>", encoding="utf-8")
print(f"看板已生成: {out}")
print(f"总资产 {money(total_mv)}  累计盈亏 {money(data['total_pnl'], True)} ({data['total_pnl_pct']:+.2f}%)")
