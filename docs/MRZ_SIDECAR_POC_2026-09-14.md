# MRZ 服务说明

本文路径为兼容既有链接保留，内容只描述当前集成实现，不再维护 PoC 调试流水账。

## 当前用途与边界

MRZ 服务用于从护照资料页图片中辅助提取 TD3 字段。PDF 由浏览器 PDF.js 逐页渲染为图片后提交，最多检查前 5 页。识别结果必须由用户核对和确认，不构成护照真伪验证。

主应用与识别服务解耦：订单系统不等待 MRZ 健康状态即可启动；sidecar 未就绪、故障或超时时，只影响识别接口，不影响订单的人工录入和其他业务。

## 当前配置

| 项目 | 当前值 |
| --- | --- |
| Compose 服务 / 容器 | `mrzscanner_poc` / `migra-mrzscanner` |
| 模型 | Docsaid `two_stage`，CPU 后端 |
| 平台 | `linux/amd64`；Apple Silicon 由 Docker Desktop 模拟运行 |
| CPU | 不设置容器 CPU 配额，实际能力由宿主机或 Docker 分配决定 |
| 内存 | 默认上限 1536 MiB，可通过 `MRZ_SIDECAR_MEM_LIMIT` 调整 |
| 推理并发 | 单 worker 串行处理 |
| 等待队列 | 最多 3 个任务，等待文件合计最多 100 MiB |
| 单文件 | 最多 20 MiB |
| 等待时间 | 默认 60 秒，包含排队和处理 |
| 中心裁切 / 后处理 | 默认关闭：`MRZ_CENTER_CROP=0`、`MRZ_POSTPROCESS=0` |
| 重试策略 | 每张图片只推理一次，不自动生成多组裁剪或增强图重试 |

sidecar 将排队文件暂存到自己的临时目录，任务结束后删除。主应用另有最多 2 个在途 MRZ 上传/转发名额，按文件内容判断格式，并在 20 MiB 边界内流式落盘和转发。成功、失败、中断与超时都必须释放名额并清理临时文件。

主应用要求 `applicants.mrz` 权限并记录 `APPLICANT_MRZ_SCAN` 操作日志；日志不得保存 MRZ 原文、护照图像或完整护照号码。

## 启动与更新

```bash
docker compose up -d --build
docker compose ps -a
docker compose logs --tail=100 postgres_migrate migra mrzscanner_poc
```

迁移容器成功退出是正常状态。MRZ 初始化期间显示 `health: starting`，模型加载后应变为 `healthy`。只修改资源参数时可重新创建识别容器：

```bash
docker compose up -d --no-deps --force-recreate mrzscanner_poc
```

## 当前验证规则

普通单元测试验证 TD3 解析、字段保留和五项校验位。独立传输回归验证以下边界：

- sidecar 不可用时返回 503，主应用保持可用；
- 超过 20 MiB 的上传返回 413；
- 两个在途任务占满主应用名额后，第三个请求返回 429；
- 转发完成后，临时目录不存在或目录为空；
- 识别接口继续执行权限检查和操作日志规则。

该回归使用受控假 sidecar，不运行 Docsaid 模型，因此不能证明识别准确率。真实模型复测使用：

```bash
docker compose --profile bench run --rm mrzscanner_bench --runs 10 --parallel 3
```

压测结果必须同时记录样本范围、成功数、字段校验情况、处理耗时、排队耗时、峰值内存、CPU 和宿主机配置。单张样本重复成功不能代表所有国家、拍摄角度或 PDF 都能正确识别。

## 运行检查

```bash
docker compose ps -a
docker compose logs --tail=200 mrzscanner_poc migra postgres_migrate
docker stats --no-stream migra-order-manager migra-postgres migra-postgres-backup migra-mrzscanner
docker inspect --format 'OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}} MemoryLimit={{.HostConfig.Memory}} NanoCPUs={{.HostConfig.NanoCpus}}' migra-mrzscanner
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/metrics
```

运行状态页以秒显示最近处理耗时、P50 和 P95；队列、拒绝、超时和内存指标用于排障，不替代真实业务样本验收。

| 现象 | 检查方向 |
| --- | --- |
| 长时间启动中或 503 | 查看 `startup_error`、模型文件、字体和依赖初始化日志 |
| 429 | 主应用在途名额或 sidecar 等待队列已满，等待当前任务完成 |
| 504 | 排队与处理超过等待时间，检查 CPU 竞争和队列耗时 |
| 容器退出或重启 | 检查 OOM、重启次数、内存上限和宿主机可用内存 |
| 识别慢但成功 | 区分处理耗时与排队耗时，确认实际 CPU 配额 |
| 识别成功但校验失败 | 核对图像质量、MRZ 两行格式和五项校验结果，必要时人工填写 |

完整系统建议从 4 GiB 内存的服务器规格开始实测；本地 Docker 结果不能直接作为 NAS 或公网服务器容量承诺。
