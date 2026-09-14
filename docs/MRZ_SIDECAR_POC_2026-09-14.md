# MRZ 部署、压测与验收记录（2026-09-14）

## 当前状态

MRZ 已并入主 Compose，完成本地业务验收，可进入日常试用。本文件沿用原 PoC 路径，内容以当前集成版本为准。

验收依据：用户确认中国、新加坡护照图片/PDF 的识别与字段核对、申请人完整保存流程、异常处理三类测试均通过。本轮文档整理没有重新执行这些测试，也不将此结论扩大为整套系统历史测试或正式服务器验收通过。

## 当前配置

| 项目 | 配置 |
| --- | --- |
| Compose 服务 / 容器 | `mrzscanner_poc` / `migra-mrzscanner` |
| 模型 | Docsaid `two_stage`，CPU 后端 |
| CPU | 不设置容器 CPU 配额，仍受宿主机或 Docker Desktop 分配限制 |
| 内存 | 默认 1536 MiB，使用 `MRZ_SIDECAR_MEM_LIMIT` 覆盖 |
| 推理并发 | 单 worker 串行处理；单个推理可以使用多个 CPU 线程 |
| 等待队列 | 最多 3 个任务，等待文件总大小最多 100 MiB |
| 单文件 | 最多 20 MiB |
| 请求等待 | 默认 60 秒，包含排队和处理；HTTP 超时不强制终止正在运行的推理 |
| 中心裁切 / 后处理 | 均关闭，`MRZ_CENTER_CROP=0`、`MRZ_POSTPROCESS=0` |
| 图片 | 每张只执行一次推理，无多组裁剪或增强图自动重试 |
| PDF | 浏览器 PDF.js 逐页渲染后提交图片，最多检查前 5 页 |

队列保存临时文件路径和元数据，任务结束后删除临时文件。主应用检查 `applicants.mrz` 权限并记录 `APPLICANT_MRZ_SCAN` 审计事件，日志不保存 MRZ 原文或文件内容。识别辅助录入，不验证证件真伪。

镜像固定为 `linux/amd64`。Apple Silicon 使用模拟运行，不能仅改平台字符串就实现当前依赖的 ARM64 原生部署。字体与模型在构建时预置，运行身份为非 root；首次构建需要下载依赖和模型。

## 启动与更新

以下命令在项目根目录执行，适用于已完成首次环境准备的本地部署：

```bash
# 统一构建主应用和 MRZ，启动数据库、备份并执行迁移
docker compose up -d --build
docker compose ps -a
docker compose logs --tail=100 postgres_migrate migra mrzscanner_poc

# 仅修改 MRZ 资源配置时，无需重建镜像
docker compose up -d --no-deps --force-recreate mrzscanner_poc
```

迁移容器成功退出是正常情况；模型初始化期间显示 health: starting，完成后应为 healthy。主应用首次启动依赖 MRZ 健康；已运行的主应用遇到 MRZ 故障时显示识别异常。

首次环境准备、公网部署和数据库恢复见 [README](../README.md)。使用公网或低资源覆盖文件的部署，更新时也须沿用相同的 `-f` 文件组合。

## 最新压测与结论

来源：用户提供的 Mac Docker Desktop 压测输出，`tests/Passport.jpg` 重复 10 次，客户端并发 3，模型仍串行处理。此测试不包含 PDF 渲染和完整浏览器上传流程。

| 指标 | 较早基线 | 当前配置 |
| --- | ---: | ---: |
| 处理耗时 P50 | 4.717 秒 | 0.695 秒 |
| 处理耗时 P95 | 6.336 秒 | 1.259 秒 |
| 客户端耗时 P50（含排队与传输） | 9.271 秒 | 1.381 秒 |
| 客户端耗时 P95（含排队与传输） | 16.985 秒 | 2.861 秒 |
| 接口成功 / 检测到 MRZ | 10/10 | 10/10 |
| 进程峰值 RSS | 1080.67 MiB | 1224.94 MiB |

当前失败、拒绝和超时均为 0，结束时队列为 0，最长排队约 2.066 秒。处理 P50 相比早期基线约快 6.8 倍；这不是严格控制其他变量的实验，不能将全部差异归因于 CPU 配额。10 次同图成功不证明所有字段正确；字段准确性由用户业务验收单独确认。

进程峰值 RSS 与 Docker 容器内存统计口径不同，不能直接用 1536 MiB 减去 RSS 作为容器精确剩余容量。正式服务器仍待实测；完整系统建议以 4 GiB 作为初始部署目标，不将当前成绩视为 2 GiB 稳定性认证。

复测无需宿主机 Node/npm：

```bash
docker compose --profile bench run --rm mrzscanner_bench --runs 10 --parallel 3
```

压测 JSON 保留毫秒供脚本统计；运行状态页以秒显示最近耗时、P50、P95。

## 运行检查与排障

```bash
docker compose ps -a
docker compose logs --tail=200 mrzscanner_poc migra postgres_migrate
docker stats --no-stream migra-order-manager migra-postgres migra-postgres-backup migra-mrzscanner
docker inspect --format 'OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}} MemoryLimit={{.HostConfig.Memory}} NanoCPUs={{.HostConfig.NanoCpus}}' migra-mrzscanner

# 默认本地端口；如设置 MRZ_POC_PORT，请替换 8090
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/metrics
```

默认内存限制应为 1610612736 字节，NanoCPUs=0 表示未设置 CPU 配额。运行状态页可见时每 30 秒刷新，隐藏时暂停；后台每分钟检查并记录异常。

| 现象 | 检查方向 |
| --- | --- |
| 长时间启动中或 HTTP 503 | 查看 startup_error 和日志，定位字体、模型或依赖初始化失败 |
| HTTP 429 | 等待队列或文件总量达到上限，待任务完成后重试 |
| HTTP 504 | 排队与处理超过等待时间，查看队列与耗时，避免反复提交 |
| 容器退出或重启 | 检查 OOM 状态、重启次数及 Docker/主机内存 |
| 识别慢但不报错 | 分别比较处理与排队耗时，检查 CPU 竞争和实际配额 |
| 识别成功但校验失败 | 人工核对原件与字段；标准 TD3 展示五项校验，接口成功不等于字段准确 |

正式服务器部署后补做目标机器性能验证与数据库恢复演练。上传附件不进入服务器备份，由用户在电脑端留档；数据库恢复与附件缺失行为见 README。
