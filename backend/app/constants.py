"""推荐规则里用到的固定档位和权重。"""

# 距离筛选器。接口只接受这些最大值，单位是英里。
DISTANCE_OPTIONS_MI: tuple[int, ...] = (100, 250, 500, 1000, 3000)

# 强标签决定核心特征，弱标签只做补充。
STRENGTH_WEIGHT: dict[str, float] = {
    "strong": 3.0,
    "weak": 1.0,
}

# 名称脱敏：可见汉字（或字符）数量。
BLIND_VISIBLE_CHARS = 2

# 大模型由开发公司提供。密钥只留在服务器环境变量，不进库、不下发。
LLM_PROVIDER_COMPANY = "ROBOTZERO"
