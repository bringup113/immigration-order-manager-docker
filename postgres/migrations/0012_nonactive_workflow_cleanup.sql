UPDATE order_steps s
SET status = 'PENDING', started_at = NULL, completed_at = NULL, skip_reason = NULL,
    version = s.version + 1, updated_at = CURRENT_TIMESTAMP
FROM orders o
WHERE o.id = s.order_id AND o.status <> 'ACTIVE' AND s.status = 'IN_PROGRESS';
