# MIGRA V1.0 移民订单管理系统

MIGRA 用于跟踪移民订单的代理来源、申请人、项目模板、办理流程、材料文件及订单收付款。项目保存可复用模板；创建订单时复制当前项目版本，此后订单可独立调整，不受模板后续修改影响。

## 已实现的业务能力

- 项目模板：合作渠道、办理流程、应收/应付方案和材料清单均可编辑、排序及版本化；收付款阶段不重复绑定渠道，应付阶段由项目默认渠道带入新订单。
- 项目包：支持导出单个项目或全部项目为版本化 JSON，并在导入前预检项目简称、渠道和币种冲突；可另存为新项目或覆盖现有模板，已有订单始终不受影响。
- 材料库：在“材料管理”集中维护常用材料、分类、默认适用范围和必需状态，并支持排序、停用和删除；项目多选导入时只复制内容，不保留关联，后续改动不会影响已有项目和订单。
- 订单：每位申请人必须上传系统固定的护照首页，并登记姓名、护照号、国籍、出生日期和有效期；图片通过 Docsaid sidecar 识别 MRZ，PDF 在浏览器内逐页渲染后提交识别，人工确认后保存全部结构化字段和校验结果；流程完成后自动启动下一步骤。
- 合同与付款：订单只保留签订日期；合同应收总额由应收计划合计表达，合同与付款页集中管理公共材料。
- 订单收支：仅记录订单实际收款和付款，原币金额、USD 本位币金额和汇率可任选两项填写，第三项自动计算并保存历史快照；不维护账户、科目、换汇或非订单流水。
- 材料文件：按“订单 / 申请人 / 材料”归档并规范重命名；每位申请人自动建立不可删除、改名或移动的“护照首页”，公共材料归入“合同与付款”；支持 PDF、JPG/JPEG、PNG、WEBP，单文件不超过 20 MB。
- 文件预览：图片自适应窗口并支持滚轮缩放、拖动；PDF 可直接预览。
- 全局搜索：支持订单、代理、申请人、护照、项目、流程、跟进、收付款金额、材料和文件名；中文名称支持全拼和首字母，使用 `+` 组合条件。
- MRZ 识别：图片通过主应用调用独立的 Docsaid `two_stage`/CPU sidecar，默认关闭中心裁切和后处理，每张图片只执行一次推理；识别服务单 worker 顺序排队，临时文件处理完成后立即删除。PDF 仍由浏览器内 PDF.js 逐页临时渲染为图片再提交识别。识别结果只用于辅助录入和校验，不代表护照真伪验证。
- 多用户：内置系统所有者、管理员和只读用户，也可创建自定义角色；用户名和显示姓名均可修改，当前会话不会因改名中断。
- 双重验证：支持标准 TOTP 动态码、扫码设置、加密密钥和一次性恢复码；公网模式会强制所有者和管理员启用。
- 会话安全：默认空闲 60 分钟、绝对 12 小时失效；个人安全页可查看设备、退出单个设备或退出其他所有设备。
- 文件权限：只读用户可以预览文件，但不能上传、修改、删除或下载。
- 操作日志：记录登录退出、用户与角色管理、业务修改及文件访问；支持按用户、模块、操作、结果和日期筛选，密码、会话令牌和护照号会脱敏。
- 冲突保护：订单和项目在数据库事务内锁定并校验版本；页面数据过期时拒绝覆盖并自动刷新最新内容。
- 代理与渠道商：代理表示订单来源，系统内置并保护“公司直营”；外部代理资料可修改、启用和停用，停用后仍作为历史订单资料保留。
- 数据库备份：Docker 每日使用 PostgreSQL custom 格式生成可校验备份，只有通过大小和目录检查后才正式保存；上传文件明确不进入备份。

所有金额都以整数最小货币单位保存，汇率以 `1e8` 精度固化。订单编号格式为“项目简称 + 签约日期 + 当日序号”，例如 `SLLA_GFG-2026090701`。

## 本地 Docker 部署

系统由四个常驻容器和一个启动时迁移容器组成：

- `migra`：Next.js 应用，只绑定本机 `127.0.0.1:3000`。
- `postgres`：PostgreSQL 17，只绑定本机 `127.0.0.1:54329`。
- `postgres_backup`：只备份 PostgreSQL 数据库，不读取上传文件目录。
- `postgres_migrate`：启动时短暂运行，使用独立迁移账号升级结构并授予最小权限，完成后退出。
- `mrzscanner_poc`：Docsaid `two_stage`/CPU MRZ 识别服务，单 worker 顺序处理，临时文件完成后立即删除。

首次启动：

```bash
cp .env.example .env
# 编辑 .env，至少设置随机且足够长的 POSTGRES_PASSWORD
npm run docker:prepare
docker compose up -d --build
docker compose ps
docker compose logs migra
```

主 Compose 会同时构建并启动主应用、PostgreSQL、备份和 MRZ sidecar。MRZ sidecar 使用 amd64 镜像；Apple Silicon Docker Desktop 会通过模拟运行。压测使用内置的 `bench` profile：

```bash
docker compose --profile bench run --rm mrzscanner_bench --runs 10 --parallel 3
```

`docker:prepare` 会生成 migrator、runtime、backup 三组独立随机密码，写入不纳入 Git 的 `.env`，把文件权限收紧为 `0600`，并在 Compose 启动前创建、检查 `data/files/` 与 `backups/postgres/` 两个宿主机挂载目录。应用容器使用宿主机当前 UID/GID 构建，以非 root 身份访问 `data/`；如果旧目录属于其他用户，准备命令会明确报错，而不会让应用进入重启循环。

浏览器打开 `http://127.0.0.1:3000`。数据库中没有任何账号时，登录页会自动显示“创建系统所有者”；由部署者填写用户名、显示姓名和密码，创建成功后直接进入系统。系统不会生成默认账号、默认密码或密码文件。

登录后可在“用户与角色”中创建账号、分配内置或自定义角色；在“登录与安全”中修改自己的密码。

项目管理页提供“导出全部”和“导入项目”，项目详情提供“导出项目”。项目包包含项目基本资料、渠道关联、流程、收付款、材料及所需币种；不包含订单、代理、账号、日志、附件或全局材料库。导入时复用相同代码的本地渠道与币种，不覆盖渠道资料和当前汇率；缺少的依赖会在预检中列出并随项目创建。

### 常用命令

```bash
# 查看运行状态
docker compose ps

# 查看应用日志
docker compose logs migra

# 停止或启动
docker compose stop
docker compose start

# 统一构建并更新主应用、MRZ 及其他服务
docker compose up -d --build

# MRZ 排障与整套系统资源观察
docker compose logs --tail=200 mrzscanner_poc
docker stats --no-stream migra-order-manager migra-postgres migra-postgres-backup migra-mrzscanner
```

MRZ 当前采用 CPU 不限额、内存上限 1536 MiB、单 worker 串行处理；最多 3 个等待任务，单文件 20 MiB，等待文件合计 100 MiB，请求等待 60 秒。中心裁切和后处理均关闭，每张图片只推理一次。资源参数仍受 Docker Desktop/宿主机分配约束。

本地最新同图 10 次压测全部成功，处理耗时 P50 为 0.695 秒、P95 为 1.259 秒。用户已确认识别与字段核对、申请人完整流程、异常处理三项业务验收通过。详细配置、数据来源、运行检查和故障排查见 [MRZ 部署与验收记录](docs/MRZ_SIDECAR_POC_2026-09-14.md)。

### 数据与备份

- PostgreSQL 数据保存在 Docker 持久化卷 `migra-postgres-data`。
- 上传文件保存在宿主机 `data/files/orders/`。
- PostgreSQL owner、migrator、runtime 和 backup 密码只保存在权限为 `0600`、且被 Git 忽略的 `.env` 中。Web 应用不使用 owner 或 migrator。
- `APP_AUTH_SECRET`（未显式配置时为 `data/.auth-secret`）用于加密双重验证密钥。它不属于上传文件，但启用双重验证后必须单独保存在密码管理器中；迁移服务器时需与数据库配套恢复。

系统默认每天自动备份一次 PostgreSQL，保留 30 天，可通过 `.env` 的 `BACKUP_INTERVAL_SECONDS` 和 `BACKUP_RETENTION_DAYS` 调整。备份统一为 `pg_dump -Fc` custom 格式，写入临时文件并通过最小大小和 `pg_restore --list` 校验后才改为正式 `.dump` 文件。失败原因会明确写入备份容器日志。也可以手动生成：

```bash
./scripts/backup-postgres.sh

# 只校验备份格式和目录
./scripts/verify-postgres-backup.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump

# 恢复到临时数据库，运行迁移、统计和文件一致性检查后自动清理
./scripts/restore-drill-postgres.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump
```

备份会写入被 Git 忽略的 `backups/postgres/`。按当前使用约定，`data/files/` 中的上传文件不备份。即使附件已经丢失，订单、申请人、收付款、流程、文件记录和操作日志等数据库数据仍可恢复；但丢失的附件内容无法通过数据库备份找回，预览和下载将不可用。恢复脚本会检查现有附件，并将附件缺失、未被数据库索引、缺少校验值、大小不一致和哈希不一致等结果写入 `data/file-integrity-report.json`。发现异常时，脚本返回非零退出码，但不会撤销已恢复的数据库，也不会自动删除或修改附件。检查在 Docker 中执行，不依赖宿主机 node_modules。

恢复前会停止应用并要求显式确认：

```bash
CONFIRM_RESTORE=YES ./scripts/restore-postgres.sh backups/postgres/migra-YYYYMMDD-HHMMSS.dump
```

## 公网部署前

当前 Compose 只监听本机，适合本地开发和验收。仓库已提供 `docker-compose.public.yml` 与 `Caddyfile` 作为公网标准模板；它会只开放 80/443、移除应用和 PostgreSQL 的宿主机端口，并启用 HTTPS、正式 Origin、Secure Cookie、HSTS、代理请求头覆盖和高权限 MFA 策略。没有正式域名、服务器和异地备份位置时不要启动该配置。

正式部署时先设置 `MIGRA_DOMAIN`，再使用基础文件与公网覆盖文件共同启动：

```bash
export MIGRA_DOMAIN=你的正式域名
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

正式上线前还应完成：

- 使用独立服务器密钥和强密码，关闭默认密码。
- 配置域名、HTTPS、可信反向代理和防火墙。
- 运行 `npm run deployment:verify`，并使用最新备份实际完成一次隔离恢复演练。
- 上传文件不做服务器备份，应确保电脑端原始文件留档完整。
- 所有系统所有者和管理员在“登录与安全”中启用双重验证并妥善保存恢复码。
- 把数据库备份加密复制到另一位置；上传文件仍不复制。
- 限制服务器上 Docker、`.env`、初始凭据和容器日志的读取权限。

## 技术结构

- React 19、Next.js 16、TypeScript
- Tailwind CSS、Shadcn UI
- Node.js 24、PostgreSQL 17
- Docker Compose
- 本位币：USD

## 低配置服务器优化（2026-09-10）

本版继续使用 PostgreSQL 搜索表，不需要 Redis。订单、代理、申请人、护照、流程、跟进、待办、金额、材料、历史文件名称/状态与结案说明参与搜索；不提取 PDF 正文或图片文字。

- **搜索更新**：迁移 0019 添加持久化增量队列，数据库触发器在业务事务内标记变更；应用后台单执行器逐单更新。通常稍后即可搜到最新修改，大批量导入时延迟取决于积压。首次升级会分批更新既有记录，搜索框会提示订单数据仍在同步。进程重启后任务保留，失败任务延迟重试。搜索不再触发全库重建；角色/订单归属仍在每次查询时校验。
- **列表**：`GET /api/data/orders` 改为 `{rows,page,pageSize,hasMore,owners}`，默认每页30条、最多100条；支持 `page`、`pageSize`、`q`、`owner`（用户ID）、`status`。前端同步更新。深分页仍采用 OFFSET。
- **详情**：`GET /api/orders/:orderNo?section=workflow|finance|people|common` 按页签读取文件/流水/跟进；默认兼容 `section=all`。跟进与流水每页50条，使用 `historyPage`、`cashPage`，并返回对应 `HasMore`。金额汇总始终针对整张订单，不能用当前页流水计算总额。结案前通过 `closure=1`读取提示，正式提交时仍在事务内重新校验。
- **新订单模板**：`GET /api/data/catalogs` 返回选择项，模板数组为空；选定项目后调用 `?projectId=...` 获取该项目模板。
- **文件**：上传流式写入 `data/files/.incoming/`，同时计算 SHA-256；成功后归档，失败/中断清理。单文件上限20MiB、单请求一个文件，每应用进程最多2个上传、8个文件读取，超限返回429。PDF支持单段 Range；多段/不可满足范围返回416。文件仍先鉴权并记录访问日志。
- **数据库**：初始化默认数据改为迁移执行；事务内使用同一连接、失败响应回滚；相邻同类 INSERT 分块合并。连接池默认5，连接等待3秒，SQL默认15秒超时；可通过 `.env.example` 的 `DB_*` 参数调整。
- **内存**：文件校验改为流式哈希，同一应用进程同时只执行一次完整性检查。前端复用用户信息，不使用后台定时请求延长空闲会话。

建议在构建机/CI生成生产镜像，低配服务器只运行镜像。仓库已有 GHCR 发布工作流；自行确认镜像来源和架构后使用镜像部署。不要在小内存业务服务器运行 `next dev` 或与业务并行构建。

完整系统加入 MRZ 后，建议以 4 GiB 作为初始部署目标，并在目标服务器上实测。以下可选配置用于收紧主应用、数据库和备份的资源上限，不代表完整系统已通过 2 GiB 验证：

```bash
docker compose -f docker-compose.yml -f docker-compose.low-resource.yml up -d
# 公网部署额外叠加 docker-compose.public.yml，并按前文配置正式域名。
```

`docker-compose.low-resource.yml` 设置应用768MiB、PostgreSQL640MiB、备份128MiB的容器上限及较小连接池；MRZ 继续继承主 Compose 的1536MiB上限且不限CPU。四个服务上限合计3072MiB，上限不是预留或实测常驻占用，也不保证特定并发容量；需要给系统、代理和页缓存留空间。文件临时目录使用持久化磁盘，避免把20MiB文件写入内存型 `/tmp`。

**升级顺序**：部署新镜像并先完成迁移0019，再启动应用。不要把新前端与旧API混用。0019为增量结构迁移；回退旧应用时可暂时保留新队列、触发器和索引，确认不再使用后再单独清理。本次未删除旧搜索字段/索引。

验证：`npm test` 包含类型/生产构建、权限、审计、金额和文件范围/哈希测试；`npm run test:integration` 增加全订单搜索、分页、并发冲突、20MiB上传边界等回归。集成测试需使用隔离数据库、测试账号及 `MIGRA_BASE_URL`、`MIGRA_DATABASE_URL`、`MIGRA_TEST_CREDENTIAL_FILE`；CI 还会先创建可重复清理的确定性业务夹具，缺少基础数据将直接失败而不跳过。有文件写入时设置 `MIGRA_TEST_UPLOAD_ROOT` 到测试服务实际使用的临时上传目录。测试不能对生产数据运行。

### 搜索浏览器 CI 与后续事项

CI 在隔离 Docker 环境中运行 `npm run test:browser`，使用固定版本 Playwright Chromium，覆盖搜索退避、截止、请求取消与结果状态保留。浏览器测试通过后才允许发布镜像。宿主机可通过 `PLAYWRIGHT_MODULE`、`CHROME_PATH`、`MIGRA_BASE_URL` 和 `MIGRA_TEST_CREDENTIAL_FILE` 指定测试环境。

数据库备份统一使用 `scripts/backup-postgres.sh`。恢复演练及正式恢复后的附件一致性检查均遵循“不备份附件”的约定。

## 维护文档

- [当前状态与后续工作](docs/IMPLEMENTATION_PLAN.md)
- [开发规范](docs/DEVELOPMENT.md)
- [源码维护审阅](docs/CODE_QUALITY.md)
- [MRZ部署与验收](docs/MRZ_SIDECAR_POC_2026-09-14.md)
- [历史性能基线](docs/PERFORMANCE_REPORT_2026-09-11.md)
