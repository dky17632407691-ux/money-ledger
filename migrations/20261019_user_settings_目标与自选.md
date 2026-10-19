# 2026-10-19 user_settings 表（财务目标 / 自选列表）

- 新表 `public.user_settings`：id(identity), owner_id(default auth.uid()), owner_name, key, value jsonb, created_at, updated_at，UNIQUE(owner_id, key)
- 用途：轻量用户配置，一个 key 一行。当前 key：`goal`（财务目标）、`watchlist`（自选标的数组）
- RLS：开启，四条策略与 accounts 同款（select/insert/update/delete 均限 owner_id = auth.uid()）
- GRANT：表的 CRUD 与 id 序列的 USAGE/SELECT 已授予 authenticated, anon
- 前端入口：store.listSettings / store.saveSetting(key, value)；state.applySettings 铺到 state.settings
