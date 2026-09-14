-- Run ONLY against the disposable loadtest database.
DO $$ BEGIN IF current_database() <> 'loadtest' THEN RAISE EXCEPTION 'Requires loadtest database'; END IF; END $$;
UPDATE users SET must_change_password=0;
INSERT INTO agents(id,code,name,created_at,updated_at) SELECT 'lae'||n,'LAE'||n,'模拟代理'||n,now(),now() FROM generate_series(1,300) n;
INSERT INTO projects(id,code,name,country,created_at,updated_at) SELECT 'lp'||n,'LP'||n,'模拟移民项目'||n,'测试国',now(),now() FROM generate_series(1,10) n;
INSERT INTO orders(id,order_no,agent_id,project_id,project_code_snapshot,project_name_snapshot,country_snapshot,project_revision,status,notes,created_at,updated_at,owner_user_id)
SELECT 'lo'||n,'LOAD-'||lpad(n::text,6,'0'),'lae'||(n%300+1),'lp'||(n%10+1),'LP'||(n%10+1),'模拟移民项目'||(n%10+1),'测试国',1,'ACTIVE','模拟订单备注 唯一标记needle'||n,now()-n*interval '1 minute',now(),(SELECT id FROM users LIMIT 1) FROM generate_series(1,3000) n;
INSERT INTO order_applicants(id,order_id,applicant_type,name,passport_no) SELECT 'la'||n,'lo'||n,'MAIN','张三'||n,'PASSPORT'||n FROM generate_series(1,3000) n;
INSERT INTO order_materials(id,order_id,name,sequence) SELECT 'lm'||n||'-'||s,'lo'||n,'护照材料'||s,s FROM generate_series(1,3000)n CROSS JOIN generate_series(1,10)s;
INSERT INTO order_progress(id,order_id,progress_date,title,details,created_at) SELECT 'lg'||n||'-'||s,'lo'||n,'2026-09-11','办理进度'||s,'材料审核与办理记录 深层搜索deep'||n,now() FROM generate_series(1,3000)n CROSS JOIN generate_series(1,10)s;
INSERT INTO order_steps(id,order_id,name,sequence,created_at,updated_at) SELECT 'ls'||n||'-'||s,'lo'||n,'办理步骤'||s,s,now(),now() FROM generate_series(1,3000)n CROSS JOIN generate_series(1,5)s;
INSERT INTO order_plans(id,order_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor) SELECT 'lf'||n,'lo'||n,'RECEIVABLE',1,'服务费用','USD',100000,100000000,100000 FROM generate_series(1,3000)n;
ANALYZE;
