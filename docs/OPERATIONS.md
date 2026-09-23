# MIGRA 部署与运维

本文收纳 [README](../README.md) 快速启动之后的部署、备份、恢复和资源配置细节。命令默认在项目根目录运行；生产恢复前应先确认当前目录和 `.env` 对应目标实例。

## 容器与启动顺序

基础 Compose 包含四个常驻服务：`migra`（Next.js）、`postgres`（PostgreSQL 17）、`postgres_backup`（自动备份）和 `mrzscanner_poc`（Docsaid CPU 识别）。`postgres_migrate` 是一次性任务，数据库健康后执行所有未应用迁移，正常退出码为 0，然后应用启动。覆盖部署时仍用同一套当前源码和 Compose 文件，不混用新前端与旧 API。

```bash
docker compose ps
docker compose logs --tail=100 postgres_migrate
docker compose logs --tail=100 migra
docker compose logs --tail=100 mrzscanner_poc
docker stats --no-stream migra-order-manager migra-postgres migra-postgres-backup migra-mrzscanner
```

首次准备要求 Node.js `22.13+` 和 npm。`npm run docker:prepare` 根据运行它的宿主机用户生成 `APP_UID` / `APP_GID`，并创建可写的 `data/files/`、`backups/postgres/`；不要在 UID 不同的临时容器里替代执行。另一台机器缺 npm 时，先安装符合版本的 Node.js/npm，再运行准备命令。准备脚本不会覆盖已有随机密码；如目录归属不符，会报错让管理员处理，不会静默放宽权限。

## 三种访问方式

| 场景 | Compose 文件 | 浏览器地址 | 重要配置 |
| --- | --- | --- | --- |
| 本机使用 | `docker-compose.yml` | `http://127.0.0.1:3000` | 默认绑定本机；需要局域网访问时在 `.env` 填固定 `APP_BIND_ADDRESS` |
| NAS + Lucky | 基础文件 + `docker-compose.nas.yml` | 内网 IP 的 HTTP、Lucky 域名的 HTTPS | `NAS_BIND_ADDRESS`、`APP_PORT`、完整 `APP_ORIGIN`；详见 [NAS 说明](NAS_ACCESS.md) |
| 自带 Caddy | 基础文件 + `docker-compose.public.yml` | 正式域名的 HTTPS | 设置 `MIGRA_DOMAIN`，由 Caddy 提供 80/443、证书与代理 |

不使用 Lucky 时，自带 Caddy 的启动示例：

```bash
export MIGRA_DOMAIN=order.example.com
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

正式公网部署应使用有效 HTTPS、正式 Origin、独立强密码和系统所有者 MFA。不要对公网暴露 PostgreSQL 或 MRZ 容器端口。`docker-compose.public.yml` 会移除主应用和 PostgreSQL 的宿主机端口；NAS + Lucky 的内外网关系见 [NAS 说明](NAS_ACCESS.md)。

## 数据在哪里

| 内容 | 位置 | 备份与恢复规则 |
| --- | --- | --- |
| 订单、用户、日志、附件记录 | Docker 卷 `migra-postgres-data` | 每日 PostgreSQL custom 备份，默认保留 30 天 |
| 上传文件 | 宿主机 `data/files/orders/` | **不进入数据库备份**；使用者另行保留原件 |
| 备份文件 | 宿主机 `backups/postgres/` | `.dump` 文件应加密复制到另一位置 |
| MFA 加密密钥 | `.env` 的 `APP_AUTH_SECRET`，或 `data/.auth-secret` | 必须单独保存在密码管理器，迁移服务器时与数据库配套恢复 |

自动备份使用 `pg_dump -Fc`，先写临时文件，检查最小大小和 `pg_restore --list`，成功后才发布正式 `.dump`。自动备份、手动备份和正式恢复共用同一把跨进程锁；脚本只在自己成功持锁时释放锁。备份失败看 `docker compose logs --tail=100 postgres_backup`。

```bash
# 手动备份并校验
./scripts/backup-postgres.sh
./scripts/verify-postgres-backup.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump

# 在临时数据库恢复、运行迁移并检查文件一致性；结束后删除临时数据库
./scripts/restore-drill-postgres.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump
```

正式恢复会覆盖当前数据库，需要显式确认：

```bash
CONFIRM_RESTORE=YES ./scripts/restore-postgres.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump
```

脚本先校验备份并停应用，然后用单事务恢复数据库，重新运行迁移和数据库权限设置，检查附件一致性，最后启动应用。数据库恢复或迁移失败时应用保持停止；附件缺失、孤儿文件、缺校验值、大小或哈希不一致时，数据库不会回滚，应用会启动，但脚本返回非零状态并保留 `data/file-integrity-report.json`。检查不会自动删除或修改附件。**仅有数据库备份无法找回丢失的文件内容**。

## 低资源配置

搜索使用 PostgreSQL 持久化增量队列，业务变更先入队，后台单执行器处理；查询仍按用户权限和 `ALL` / `OWN` 订单范围校验。索引积压时搜索结果可能暂时落后，界面显示同步提示。列表由服务端分页，详情按模块和历史页读取；上传采用流式写入并计算 SHA-256，单文件最大 20 MiB。

主应用默认数据库连接池为 5，连接等待 3 秒，SQL 默认超时 15 秒。低资源覆盖文件将应用限制在 768 MiB、数据库 640 MiB、备份 128 MiB，连接池降到 4；MRZ 继续使用基础 Compose 的 1536 MiB 内存上限、CPU 不限额。四个容器上限合计约 3 GiB，**上限不是常驻占用，也不代表完整系统通过 2 GiB 验证**。建议从 4 GiB 机器开始，在目标硬件上测峰值内存、磁盘和实际 MRZ 排队时间。

```bash
docker compose -f docker-compose.yml -f docker-compose.low-resource.yml up -d
# NAS 部署叠加 docker-compose.nas.yml；Caddy 公网部署叠加 docker-compose.public.yml。
```

MRZ 单 worker 顺序处理，默认最多 3 个等待任务，单文件 20 MiB，等待文件合计 100 MiB，请求等待 60 秒；中心裁切与后处理关闭。图片由 sidecar 识别；PDF 在浏览器中逐页临时渲染。服务故障只影响识别功能，人工录入仍可进行。参数与验证边界见 [MRZ 服务说明](MRZ_SIDECAR_POC_2026-09-14.md)。

## 发布前验证

`npm test` 包含 ESLint、Docker 目标生产构建和单元/策略测试。`npm run test:backup`、`npm run test:prepare` 分别检查运维脚本和环境准备。`npm run test:integration` 只用于隔离应用与隔离 PostgreSQL，要求 `MIGRA_BASE_URL`、`MIGRA_DATABASE_URL`、`MIGRA_TEST_USERNAME` 和 `MIGRA_TEST_PASSWORD`；缺少条件会直接失败。MRZ 传输测试需受控假 sidecar 和 `MIGRA_MRZ_TRANSFER_TEST=1`，不得对生产识别服务运行。

CI 在隔离 Docker 环境执行桌面和手机浏览器回归，再做部署权限与备份恢复演练；只有 verify 任务通过才发布主应用 GHCR 镜像。MRZ 镜像仍由部署端从源码构建，不能把主应用镜像当作整套系统镜像。

```bash
npm test
npm run test:backup
npm run test:prepare

# 使用隔离应用、Playwright Chromium 和临时测试账号
npm run test:browser
npm run test:browser:current
npm run test:browser:mobile:real

# 检查正在运行的目标环境
npm run deployment:verify
```

浏览器与集成测试会创建或修改测试夹具，必须按 [当前验证记录](CODE_QUALITY.md) 所述在隔离环境执行。历史压测见 [2026-09-11 性能报告](PERFORMANCE_REPORT_2026-09-11.md)，只能作为当时配置的参考。
