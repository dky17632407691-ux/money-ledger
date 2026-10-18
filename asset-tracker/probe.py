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


TESTS = [
    ("腾讯 A股 600519", "https://qt.gtimg.cn/q=sh600519", None, "gbk"),
    ("腾讯 港股 00700", "https://qt.gtimg.cn/q=hk00700", None, "gbk"),
    ("腾讯 美股 AAPL", "https://qt.gtimg.cn/q=usAAPL", None, "gbk"),
    ("腾讯 多标的", "https://qt.gtimg.cn/q=sh600519,hk00700,usAAPL", None, "gbk"),
    ("天天基金 实时估值 110011", "https://fundgz.1234567.com.cn/js/110011.js", None, "utf-8"),
    (
        "天天基金 历史净值 110011",
        "https://api.fund.eastmoney.com/f10/lsjz?fundCode=110011&pageIndex=1&pageSize=5",
        {"Referer": "https://fundf10.eastmoney.com/"},
        "utf-8",
    ),
    ("新浪 多标的", "https://hq.sinajs.cn/list=sh600519,hk00700,gb_aapl",
     {"Referer": "https://finance.sina.com.cn"}, "gbk"),
]

for name, url, hdr, enc in TESTS:
    try:
        body = get(url, hdr).decode(enc, errors="replace")
        print(f"[OK] {name}  len={len(body)}")
        print(body[:400].replace("\n", " "))
    except Exception as e:
        print(f"[FAIL] {name}: {type(e).__name__} {e}")
    print("-" * 70)
