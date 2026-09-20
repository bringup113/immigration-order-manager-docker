-- Applicants may be created with only their display name.
-- NULL means not provided; existing non-empty and uniqueness checks still
-- validate any passport number that is supplied. Multiple NULLs are allowed.
ALTER TABLE order_applicants ALTER COLUMN passport_no DROP NOT NULL;
