# MIGRA 当前状态与后续工作

更新日期：2026-09-24。本文只保留当前源码状态、固定产品决策和下一步工作。

## 当前状态

- 当前维护目录为 `immigration-order-manager-docker`；`package.json` 版本为 `1.0.3`，移动工作台功能基线提交为 [`5edd090`](https://github.com/bringup113/immigration-order-manager-docker/commit/5edd0901db7851a54ea2507460d8d88febf71508)。`v1.0.2` 标签保留此前稳定基线；移动工作台随 `v1.0.3` 发布。
- 主应用、PostgreSQL、自动备份、一次性迁移容器和 Docsaid MRZ sidecar 已纳入同一套 Docker Compose。
- 当前数据库结构包含 25 个顺序迁移；全新隔离数据库已使用当前源码完成 25/25 迁移。
- 申请人支持分阶段录入；新订单模板日期、订单排序、首页提醒、MRZ 流式传输和 NAS 内外网访问均已进入当前源码。
- 当前源码已通过本地生产构建、ESLint、54 项单元/策略测试、13 项备份与附件脚本测试、3 项 Docker 目录准备测试、33 项隔离集成回归及 3 项会话与权限安全回归。
- 桌面搜索自动刷新、提醒跳转、订单排序、新订单日期联动与仅姓名建单，以及手机深链、四入口、四模块详情、流程、跟进、收付款、材料和 PWA 缓存边界已通过隔离浏览器回归。
- MFA、权限层级、备份恢复、附件事务、大额金额、计划结清提醒、纯分隔符搜索和结案响应边界修复已进入当前基线。
- 当前源码已部署到目标 NAS；数据库迁移、原有数据数量、容器权限、内外网 PWA 公共资源及公网登录返回路径均已验收。历史性能报告仍只保留为旧环境参考。
- 手机端在 `/m` 使用工作台、订单、搜索、我的四个入口；订单详情默认进入办理与跟进，没有独立订单概览。完整建单和后台管理仍在桌面端。

## 固定产品决策

1. 系统以个人或小团队办理移民订单为主，保留负责人及 `ALL` / `OWN` 订单数据范围，不扩展复杂协同流程。
2. 财务只管理订单计划和实际收付；金额保存整数最小单位，汇率保存快照，本位币为 USD，不建立账户、科目或总账。
3. 项目是可复用模板，订单创建时复制项目快照；项目后续修改不影响已有订单。
4. 申请人材料归属于申请人，公共材料归入“合同与付款”；文件按订单、申请人、材料分层保存并规范命名。
5. 创建订单和开始办理只要求申请人显示名称；护照资料允许后补。每位申请人仍有固定护照首页材料，MRZ 只辅助录入，最终由人工确认。
6. 上传附件不进入服务器备份，原件由使用者电脑留档；数据库定期备份，MFA 加密密钥单独保管。
7. 文件和收付款采用作废/恢复保留历史；危险操作使用统一确认弹窗。
8. 新增、修改或删除业务功能时，同步完成服务端权限、订单范围、前端入口、审计日志和自动化测试。
9. 只维护当前标准，不新增旧版兼容入口；数据库迁移历史必须保留以支持空库重建和已有部署升级。
10. 未经逐项核对和用户确认，不自动删除孤立文件、业务附件或数据库记录。

## 当前模块索引

| 领域 | 主要入口 |
| --- | --- |
| 数据库与迁移 | `db/`、`postgres/migrations/` |
| 权限、会话、审计 | `lib/permissions.ts`、`lib/docker-auth.ts`、`lib/audit.ts`、`lib/order-access.ts` |
| 订单业务 | `lib/order-service.ts`、`lib/order-workflow.ts`、`lib/order-finance.ts`、`lib/order-applicants.ts`、`lib/order-closure.ts` |
| 项目包 | `lib/project-package.ts` |
| 申请人与 MRZ | `lib/passport-mrz.ts`、`app/api/mrz/scan/`、`mrz-sidecar/` |
| 搜索与提醒 | `lib/order-search.ts`、`lib/search-worker.ts`、`lib/dashboard-query.ts` |
| 移动工作台 | `app/m/`、`components/mobile/`、`app/manifest.ts`、`public/sw.js` |
| 运维 | `lib/system-health.ts`、`scripts/`、`docker-compose*.yml` |

## 下一步

- [x] 移动工作台功能提交的 [`5edd090` GitHub Actions](https://github.com/bringup113/immigration-order-manager-docker/actions/runs/35902230812) 已完成并通过；发布任务依赖 verify 门禁。后续提交的运行结果以 [Actions 页面](https://github.com/bringup113/immigration-order-manager-docker/actions) 为准。
- [ ] 在 iPhone 与 Android 真机完成安装、摄像头、文件选择器、键盘与安全区检查，并用脱敏样本复测 MRZ 图片/PDF 的准确率、耗时和峰值内存。
- [x] 已在目标 NAS 按实际域名、Lucky、Origin 和 MFA 策略部署；应用、数据库、备份及 MRZ 容器健康，公网 HTTPS 与移动登录返回路径正常。
- [ ] 定期对最新数据库备份执行隔离恢复演练；数据库备份异地加密保存，附件继续由电脑端留档。
- [x] 当前移动工作台及订单优化已推送到 GitHub `main`；本地 M6 门禁、NAS 部署、基础性能和公网 HTTPS 资源已验证。

## 文档分工

- [README](../README.md)：图文产品入口和部署快速开始。
- [开发约束](DEVELOPMENT.md)：长期有效的代码、权限、日志、数据和测试规则。
- [移动工作台说明](MOBILE_PWA_DEVELOPMENT_PLAN.md)：当前手机端范围、页面结构图、代码复用、安装与缓存边界、阶段和验收标准。
- [部署与运维说明](OPERATIONS.md)：备份恢复、资源配置、常用命令与测试条件。
- [当前源码审阅与验证](CODE_QUALITY.md)：当前结构、已知边界和最近一次可重复验证结果。
- [MRZ 服务说明](MRZ_SIDECAR_POC_2026-09-14.md)：当前识别配置、运行检查和验证边界。
- [历史性能基线](PERFORMANCE_REPORT_2026-09-11.md)：特定旧环境下的实测数据，只作历史参考。
