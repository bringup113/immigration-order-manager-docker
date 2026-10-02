# MRZ 服务说明

更新日期：2026-10-01。本文只描述当前正式集成，不保留 PoC 调试过程。

## 用途与边界

MRZ 服务从护照资料页图片中辅助提取 TD3 字段。PDF 由浏览器 PDF.js 逐页渲染为图片后提交，最多检查前 5 页。识别结果必须由用户核对和确认，不构成护照真伪验证。

主应用与识别服务解耦：订单系统不等待 MRZ 健康状态即可启动；sidecar 未就绪、故障或超时时，只影响识别接口，不影响人工录入和其他业务。

## 当前配置

| 项目 | 当前值 |
| --- | --- |
| Compose 服务 / 容器 | `mrzscanner_poc` / `migra-mrzscanner` |
| 模型 | Docsaid `two_stage`，CPU 后端 |
| 平台 | `linux/amd64`；Apple Silicon 由 Docker Desktop 模拟运行 |
| CPU | 不设置容器 CPU 配额 |
| 内存 | 默认上限 1536 MiB，可通过 `MRZ_SIDECAR_MEM_LIMIT` 调整 |
| 推理并发 | 单 worker 串行处理 |
| 等待队列 | 最多 3 个任务，等待文件合计最多 100 MiB |
| 单文件 / 等待时间 | 20 MiB / 60 秒（含排队和处理） |
| 中心裁切 / 后处理 | 默认关闭 |
| 重试 | 每张图片只推理一次，不自动生成多组裁剪或增强图 |

sidecar 将排队文件暂存到临时目录，任务结束后删除。主应用另有最多 2 个在途上传／转发名额，在 20 MiB 边界内流式落盘和转发。成功、失败、中断与超时都必须释放名额并清理临时文件。

接口要求 `applicants.mrz` 权限并记录 `APPLICANT_MRZ_SCAN`；日志不得保存 MRZ 原文、护照图像或完整护照号码。

## 启动、验证与排障

```bash
docker compose up -d --build
docker compose ps -a
docker compose logs --tail=100 postgres_migrate migra mrzscanner_poc
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/metrics
```

迁移容器成功退出是正常状态。MRZ 初始化期间显示 `health: starting`，模型加载后应变为 `healthy`。

普通单元测试验证 TD3 字段和五项校验位。`npm run test:mrz-transfer` 使用受控假 sidecar，验证服务不可用、20 MiB 上限、并发拒绝和临时文件清理；它不证明模型识别准确率。真实模型复测使用：

```bash
docker compose --profile bench run --rm mrzscanner_bench --runs 10 --parallel 3
```

压测必须同时记录样本范围、成功数、字段校验、处理与排队耗时、峰值内存、CPU 和宿主机配置。单张样本重复成功不能代表所有国家、拍摄角度或 PDF。

| 现象 | 检查方向 |
| --- | --- |
| 长时间启动中或 503 | `startup_error`、模型文件、字体和依赖初始化日志 |
| 429 | 主应用在途名额或 sidecar 队列已满 |
| 504 | 排队与处理超过等待时间，检查 CPU 和队列 |
| 容器退出或重启 | OOM、重启次数、内存上限和宿主机可用内存 |
| 识别成功但校验失败 | 图像质量、MRZ 两行格式和五项校验结果；必要时人工填写 |

完整系统建议从 4 GiB 内存规格开始实测；本地 Docker 结果不能直接作为 NAS 或公网服务器容量承诺。

2026-10-01 的本机档位测试显示，单张测试图片在不限 CPU 时处理 P50 约 0.72 秒；限制为 1／2／4 CPU 后分别约为 11.49／4.05／1.91 秒。峰值 RSS 为 953～971 MiB，因此当前不设置 CPU 配额并保留 1536 MiB 内存上限。测试环境、完整数字和适用边界见[当前性能基线](PERFORMANCE_BASELINE.md)。
