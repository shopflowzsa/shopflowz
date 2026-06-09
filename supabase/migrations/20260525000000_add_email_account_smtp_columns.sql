-- Add missing columns to user_email_accounts if they don't exist yet.
-- This fixes a migration gap where smtp_port, use_for_sending, signature,
-- and notification_sound were omitted from the original CREATE TABLE.

ALTER TABLE user_email_accounts
  ADD COLUMN IF NOT EXISTS smtp_port          integer NOT NULL DEFAULT 465,
  ADD COLUMN IF NOT EXISTS use_for_sending    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature          text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notification_sound text    NOT NULL DEFAULT 'ding';
