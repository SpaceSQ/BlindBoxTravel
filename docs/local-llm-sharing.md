# 本地大模型共享（附件一摘要）

这是内部白皮书《22 款 APP 内部大模型共享式调用机制与绿色通道方案》的落地摘要。盲盒旅行（Mystery Getaway）按这份架构接入零号 / 智家生态，不把模型锁在单个 App 的沙盒里。

## 要解决的事

22 款 App 同时装在一台手机上时，各自再下一份大模型会浪费存储和流量。目标是一次下载，生态内复用。

## 共享容器

- iOS App Group：`group.com.robotzero.shared.ai`
- 权重目录：`group.com.robotzero.shared.ai/models/`
- Android：优先尝试公共文档目录 `Documents/RobotZeroSharedAI/models/`。写不进去时，退回该 App 外部目录下的同一相对路径。跨 App 真正互挂在 Android 上还没有签名级共享提供者，这一点见文末缺口。

`app.json` 写入了 App Group entitlement，`plugins/withRobotZeroSharedAI.js` 在 prebuild 时再次保证 entitlement、Info.plist 里的 `RobotZeroSharedAIGroup`，以及微信 / WhatsApp 的包可见性。原生模块 `modules/robotzero-shared-ai` 用 `containerURL(forSecurityApplicationGroupIdentifier:)` 取共享目录。没有编进原生包时（Expo Go、网页预览），JS 退回本 App 文档目录里的同名路径，设置页会说明这是沙盒副本。

## 扫描

`frontend/src/utils/ecosystemScanner.ts` 在发起下载之前先读共享目录里的 manifest。

同源关键字与白皮书一致：

`dearearth` `dearsage` `dearecho` `dearhome` `dearpet` `dearbody` `dearmuse` `dearalien` `ahomeeasy` `mhomeeasy` `khomeeasy` `xhomeeasy` `voltpilot` `starscope` `quoteshield` `meshdoctor` `powerark` `ghostradar` `elderguard` `hometwin` `solartruth` `billsniper`

盲盒旅行自己的宿主 id 是 `mysterygetaway`（包名 `com.blindboxtravel.app`）。它不在上面 22 个关键字里，但本 App 写出的 manifest 会被当成绿色通道成员，这样下载完成后能成为其他生态 App 的共享源。

一份模型可用，需要同时满足：状态 `ready`、体积至少 8 MB、磁盘大小和 manifest 一致、宿主是本 App 或命中上述关键字。外部 App 放下的文件不会自动挂载。

优先级：本 App 已经下好的权重大于兄弟 App 的共享权重。两者都算“已经有了”，都不会再下载。都没有，才开始下载。

## 三级调度

`frontend/src/engines/aiPriorityScheduler.ts`：

1. 当前 App 的请求插到队列最前。
2. 生态 App 走绿色通道，默认允许，没有开关。
3. 外部 App 看 AsyncStorage 键 `allow_external_sharing`。缺省和 `"false"` 都拒绝，只有用户在设置里打开才放行。

## 下载

推荐包是 SmolLM2 135M Instruct Q4（约 100 MB），地址可用 `EXPO_PUBLIC_LOCAL_MODEL_URL` 覆盖。默认地址是 Hugging Face 上的公开 GGUF，App 里不放任何 API key。

下载走 `expo-file-system` 的 `DownloadTask`（可暂停，`savable()` 记在本机，下次继续）。没有原生暂停数据、但磁盘上已有半截文件时，用 HTTP `Range` 续传。完成后写 manifest，宿主记为 Mystery Getaway。

设置页文案在扫描时是「正在检测零号生态共享大模型……」。挂上兄弟 App 的模型时，会写明由哪个宿主提供。

## 和云端的关系

`LocalLLMProvider`（`frontend/src/localLlm/provider.ts`）是本机推理的接口。探索行程会先走当前 App 优先级，再决定本地还是云端。

这一版 **没有** 接上 llama.cpp 或 MLX。`ON_DEVICE_RUNTIME_LINKED` 为 false。因此即使用户已经挂上权重，真正的行程解析仍调用现有后端 `/api/recommend`。云端密钥继续只存在服务器的 `OPENAI_*` / `LLM_*` 环境变量里，客户端协议不变，不回传密钥。

没有本地模型时走云端。有本地模型但推理引擎没接上时，也走云端，并在设置里说明，避免假装已经在手机上运算。

## 这一版还没做完的部分

- 手机上的推理运行时没有编进包里，挂载不等于本地出答案。
- iOS 共享要在开发者后台给 `com.blindboxtravel.app` 打开同一个 App Group，entitlement 文件本身不够。
- Android 公共目录在新系统上经常不可写，兄弟 App 互挂还没有可过商店审核的共享存储实现。
- Expo Go 读不到 App Group，只能看到沙盒里的同名目录。
- 构建机访问 Hugging Face 可能被拒（401）。下载地址需要在真机网络下确认；失败时不会把错误页当成模型。
