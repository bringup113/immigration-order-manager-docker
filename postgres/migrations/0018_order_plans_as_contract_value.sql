DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='contract_currency'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='default_receivable_currency'
  ) THEN
    ALTER TABLE projects RENAME COLUMN contract_currency TO default_receivable_currency;
  END IF;
END $$;

ALTER TABLE orders
  DROP COLUMN IF EXISTS contract_currency,
  DROP COLUMN IF EXISTS contract_amount_minor,
  DROP COLUMN IF EXISTS contract_rate_scaled,
  DROP COLUMN IF EXISTS contract_base_minor;
