-- Migration 032: Security — rate limiting, email OTP 2FA, login audit log

-- Track failed login attempts per email for brute-force protection
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL,  -- email or "otp:<userId>"
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(identifier, attempted_at);

-- Email OTP codes (one active per user at a time)
CREATE TABLE IF NOT EXISTS login_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_otps_user ON login_otps(user_id, expires_at);

-- Audit log for all login events
CREATE TABLE IF NOT EXISTS login_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed_password', 'failed_otp', 'locked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at);
