"""把最新行情数据注入网页原型模板，生成 webapp/index.html。"""

import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
latest_path = BASE / "data" / "latest.json"
tpl_path = BASE / "webapp" / "template.html"
out_path = BASE / "webapp" / "index.html"

data = json.loads(latest_path.read_text(encoding="utf-8"))
tpl = tpl_path.read_text(encoding="utf-8")

if "__DATA__" not in tpl:
    raise SystemExit("模板中找不到 __DATA__ 占位符")

payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
out_path.write_text(tpl.replace("__DATA__", payload), encoding="utf-8")

print(f"已生成 {out_path}")
print(f"持仓 {len(data['holdings'])} 只  总资产 ¥{data['total_market_value']:,.0f}")
