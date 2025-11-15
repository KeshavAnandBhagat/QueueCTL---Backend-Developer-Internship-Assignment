/*
  # QueueCTL Job Queue System Schema

  1. New Tables
    - `jobs`
      - `id` (text, primary key) - Unique job identifier
      - `command` (text, required) - Shell command to execute
      - `state` (text, required) - Job state: pending, processing, completed, failed, dead
      - `attempts` (integer, default 0) - Number of execution attempts
      - `max_retries` (integer, default 3) - Maximum retry attempts before moving to DLQ
      - `created_at` (timestamptz) - Job creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
      - `scheduled_at` (timestamptz, nullable) - When job should be executed (for delayed jobs)
      - `last_error` (text, nullable) - Last error message if failed
      - `output` (text, nullable) - Job execution output
      - `locked_by` (text, nullable) - Worker ID that locked this job
      - `locked_at` (timestamptz, nullable) - When job was locked

    - `config`
      - `key` (text, primary key) - Configuration key
      - `value` (text, required) - Configuration value
      - `updated_at` (timestamptz) - Last update timestamp

    - `workers`
      - `id` (text, primary key) - Worker identifier
      - `status` (text, required) - Worker status: active, stopped
      - `started_at` (timestamptz) - When worker started
      - `last_heartbeat` (timestamptz) - Last heartbeat timestamp
      - `current_job_id` (text, nullable) - Currently processing job ID

  2. Indexes
    - Index on jobs.state for fast filtering
    - Index on jobs.scheduled_at for delayed job processing
    - Index on jobs.locked_by for worker job tracking

  3. Security
    - Enable RLS on all tables
    - Allow public access for CLI operations (service role key will be used)
*/

-- Create jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  command text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  last_error text,
  output text,
  locked_by text,
  locked_at timestamptz
);

-- Create config table
CREATE TABLE IF NOT EXISTS config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create workers table
CREATE TABLE IF NOT EXISTS workers (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  current_job_id text REFERENCES jobs(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_locked_by ON jobs(locked_by) WHERE locked_by IS NOT NULL;

-- Insert default configuration
INSERT INTO config (key, value) VALUES 
  ('max_retries', '3'),
  ('backoff_base', '2')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;

-- Create policies for service role access
CREATE POLICY "Service role can manage jobs"
  ON jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage config"
  ON config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage workers"
  ON workers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);