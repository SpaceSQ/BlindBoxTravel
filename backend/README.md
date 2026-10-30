# 盲盒旅游后端

自然语言收成标签，再按标签权重和距离档位推荐景点。未解锁时名称只用种子数据里的盲盒名（露出两个字），不返回全名和门票价格。

## 运行

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

数据库文件在 `app/data/blindbox.sqlite`。改了词表或景点后执行 `python -m app.seed --reset`。

大模型由开发公司 ROBOTZERO 提供，写入 `llm_providers`。密钥只放在服务器环境变量，接口不把密钥或接口地址返回给客户端，终端用户也不填写。服务器没有密钥时，推荐仍用关键词匹配。要接兼容 `/chat/completions` 的模型，把密钥写进服务器的 `.env`。

## 推荐

`POST /api/recommend`

```json
{
  "query": "我想去个有异星感的地方露营，大概1000公里内",
  "origin": {"lat": 39.9042, "lng": 116.4074}
}
```

`max_distance_km` 可选。传入时必须是 `500, 1000, 2000, 3000, 4000, 5000, 6000` 之一，并覆盖句子里解析出的距离。句子里的其他数字会抬到能覆盖它的最小档位。

返回的景点满足：球面距离不超过该档位，且命中强标签，或至少命中一半请求标签。强标签权重 3，弱标签权重 1。

## 解锁

列表和未解锁详情只有 `display_name`（盲盒名）、简介和介绍。`POST /api/spots/{spot_id}/unlock` 提交出发日期、天数和人数后，返回全名、门票价格，并把 `can_review` 设为 true。之后用返回的 `unlock_token` 再请求详情，保持解锁状态。

距离下拉框的档位在 `GET /api/meta`。
