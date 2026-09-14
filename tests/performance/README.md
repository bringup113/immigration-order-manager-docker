# 独立 Docker 压测

这些脚本只用于可销毁的模拟环境。不要指向当前业务数据库。

环境约定：
- 数据库容器：migra-loadtest-db，数据库：loadtest（seed.sql 会检查库名）。
- 应用容器：migra-loadtest-app，宿主机地址：http://127.0.0.1:3310。
- 应用与数据库各限制 1 CPU，内存分别 768m、640m；应用 DB_POOL_MAX=4。
- 新库运行全部迁移；启动应用创建初始账号后，再运行 seed.sql。
- 本轮隔离环境使用数据库 owner 连接；生产最小权限角色已在之前集成测试覆盖，本轮不重复权限验证。

顺序运行：

```sh
docker exec -i migra-loadtest-db psql -U postgres -d loadtest -v ON_ERROR_STOP=1 < tests/performance/seed.sql
node tests/performance/load.mjs
node tests/performance/writes.mjs
```

seed.sql 生成 3,000 订单、300 代理、10 项目、3,000 申请人、30,000 材料、30,000 进度、15,000 步骤和3,000 费用计划。仅在全新压测库执行一次。

load.mjs 从隔离容器读取测试凭据且不打印，执行无思考时间的闭环 HTTP 并发，包含第一页/第80页订单、精确/常见中文/拼音搜索、工作流/财务详情和仪表盘。资源采样每5秒异步执行，不能代表瞬时峰值。输出为 docs/PERFORMANCE_RESULTS_2026-09-11.json。

writes.mjs 在5并发下通过业务 API 创建100个订单，验证唯一订单号及错误。输出为 docs/PERFORMANCE_WRITES_2026-09-11.json。

运行前确保 Docker 可用及 Node >=22.13。压测会产生测试数据和登录会话；完成后销毁这两个容器及专用网络即可。每个测试容器都必须使用独立临时存储，不能挂载业务 data 目录。
