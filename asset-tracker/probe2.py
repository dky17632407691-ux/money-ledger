import ssl
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
}


def get(url, headers=None, timeout=12):
    h = dict(UA)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


print("=" * 70)
print("1) 多只基金历史净值")
for code in ["110011", "000001", "161725", "005827", "012414"]:
    url = (
        f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}"
        "&pageIndex=1&pageSize=2"
    )
    try:
        import json

        body = get(url, {"Referer": "https://fundf10.eastmoney.com/"}).decode("utf-8")
        d = json.loads(body)
        lst = d["Data"]["LSJZList"]
        if lst:
            r = lst[0]
            print(f"  [OK] {code}  {r['FSRQ']}  净值={r['DWJZ']}  日涨跌={r['JZZZL']}%")
        else:
            print(f"  [EMPTY] {code}")
    except Exception as e:
        print(f"  [FAIL] {code}: {type(e).__name__} {e}")

print("=" * 70)
print("2) 汇率接口")
FX = [
    ("腾讯 hkHKDCNY", "https://qt.gtimg.cn/q=hkHKDCNY", "gbk"),
    ("腾讯 usUSDCNY", "https://qt.gtimg.cn/q=usUSDCNY", "gbk"),
    ("新浪 fx_shkdcny", "https://hq.sinajs.cn/list=fx_shkdcny",
     "gbk"),
    ("新浪 fx_susdcny", "https://hq.sinajs.cn/list=fx_susdcny",
     "gbk"),
]
for name, url, enc in FX:
    try:
        hdr = {"Referer": "https://finance.sina.com.cn"} if "sina" in url else None
        body = get(url, hdr).decode(enc, errors="replace")
        print(f"  [{'OK' if len(body) > 30 else 'EMPTY'}] {name}: {body[:200]}")
    except Exception as e:
        print(f"  [FAIL] {name}: {type(e).__name__} {e}")

print("=" * 70)
print("3) 美股/港股 昨日收盘字段")
body = get("https://qt.gtimg.cn/q=usAAPL,hk00700").decode("gbk")
for line in body.strip().split(";"):
    line = line.strip()
    if not line:
        continue
    key, _, val = line.partition("=")
    f = val.strip('"').split("~")
    print(f"  {key} -> name={f[1]}, 现价={f[3]}, 昨收={f[4]}, 开盘={f[5]}, 币种={f[30] if len(f)>30 else '?'}")
