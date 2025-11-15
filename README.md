# QueueCTL - Background Job Queue System

A production-grade CLI-based background job queue system with worker processes, automatic retries using exponential backoff, and a Dead Letter Queue (DLQ) for permanently failed jobs.

## Features

- **Job Queue Management**: Enqueue and track background jobs
- **Multiple Workers**: Run parallel worker processes to execute jobs concurrently
- **Automatic Retries**: Failed jobs retry automatically with exponential backoff
- **Dead Letter Queue**: Jobs that exhaust retries move to DLQ for manual inspection
- **Persistent Storage**: All job data persists in Supabase database across restarts
- **Graceful Shutdown**: Workers complete current jobs before stopping
- **CLI Interface**: Full-featured command-line interface for all operations
- **Configurable**: Adjust retry count and backoff settings

## Architecture Overview

### Components

1. **Job Queue**: Stores all jobs with states (pending, processing, completed, failed, dead)
2. **Workers**: Independent processes that poll for pending jobs and execute them
3. **Database**: Supabase PostgreSQL database for persistent job storage
4. **CLI**: Commander.js-based interface for all operations

### Job Lifecycle

```
pending → processing → completed
    ↓           ↓
  failed  →  dead (DLQ)
    ↑
    └─ (retry with backoff)
```

### Data Model

**Jobs Table**:
- `id`: Unique job identifier
- `command`: Shell command to execute
- `state`: Current job state
- `attempts`: Number of execution attempts
- `max_retries`: Maximum retries before moving to DLQ
- `created_at`, `updated_at`: Timestamps
- `scheduled_at`: Optional delayed execution time
- `last_error`: Last error message
- `output`: Job execution output
- `locked_by`, `locked_at`: Worker locking mechanism

**Config Table**:
- `max_retries`: Default maximum retry attempts (default: 3)
- `backoff_base`: Exponential backoff base (default: 2)

**Workers Table**:
- `id`: Worker identifier
- `status`: Worker status (active/stopped)
- `started_at`: Worker start time
- `last_heartbeat`: Last heartbeat timestamp
- `current_job_id`: Currently processing job

## Setup Instructions

### Prerequisites

- Node.js v18+ installed
- Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd queuectl
```

2. Install dependencies:
```bash
npm install
```

3. Configure Supabase connection:
   - Update `.env` file with your Supabase credentials:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

4. Link the CLI globally (optional):
```bash
npm link
```

5. Verify installation:
```bash
queuectl --help
```

## Usage Examples

### Enqueue a Job

Add a simple job:
```bash
queuectl enqueue '{"id":"job1","command":"echo Hello World"}'
```

Add a job with custom retry limit:
```bash
queuectl enqueue '{"id":"job2","command":"sleep 2","max_retries":5}'
```

Add a delayed job (scheduled for future execution):
```bash
queuectl enqueue '{"id":"job3","command":"echo Delayed","scheduled_at":"2025-11-15T12:00:00Z"}'
```

### Start Workers

Start a single worker:
```bash
queuectl worker start
```

Start multiple workers (parallel processing):
```bash
queuectl worker start --count 3
```

Workers will run until you press Ctrl+C (graceful shutdown).

### Check Status

View queue summary and active workers:
```bash
queuectl status
```

Output:
```
=== Job Queue Status ===

Total Jobs:      10
Pending:         3
Processing:      1
Completed:       5
Failed:          0
Dead (DLQ):      1

Active Workers:  2

--- Active Workers ---
  worker-abc123: Processing job-xyz (uptime: 45s)
  worker-def456: Idle (uptime: 42s)
```

### List Jobs

List all jobs:
```bash
queuectl list
```

List jobs by state:
```bash
queuectl list --state pending
queuectl list --state completed
queuectl list --state failed
queuectl list --state dead
```

### Dead Letter Queue (DLQ)

List jobs in DLQ:
```bash
queuectl dlq list
```

Retry a failed job from DLQ:
```bash
queuectl dlq retry job1
```

### Configuration

View all configuration:
```bash
queuectl config list
```

Set maximum retries:
```bash
queuectl config set max-retries 5
```

Set exponential backoff base:
```bash
queuectl config set backoff-base 3
```

Get a specific config value:
```bash
queuectl config get max-retries
```

### Stop Workers

Stop all running workers:
```bash
queuectl worker stop
```

Note: Workers performing active jobs will complete them before stopping.

## Testing Instructions

### Basic Test Scenario

1. Start a worker:
```bash
queuectl worker start
```

2. In another terminal, enqueue a simple job:
```bash
queuectl enqueue '{"id":"test1","command":"echo Success"}'
```

3. Check status:
```bash
queuectl status
```

4. List completed jobs:
```bash
queuectl list --state completed
```

### Retry Test Scenario

1. Ensure a worker is running

2. Enqueue a job that will fail:
```bash
queuectl enqueue '{"id":"fail1","command":"exit 1","max_retries":3}'
```

3. Watch worker logs - you'll see retries with exponential backoff:
   - Attempt 1: immediate
   - Attempt 2: after 2 seconds (2^1)
   - Attempt 3: after 4 seconds (2^2)
   - After 3 failures: moved to DLQ

4. Check DLQ:
```bash
queuectl dlq list
```

5. Retry from DLQ:
```bash
queuectl dlq retry fail1
```

### Multiple Worker Test

1. Start 3 workers:
```bash
queuectl worker start --count 3
```

2. Enqueue multiple jobs quickly:
```bash
for i in {1..10}; do
  queuectl enqueue "{\"id\":\"job$i\",\"command\":\"sleep 3\"}"
done
```

3. Watch status - jobs should be processed in parallel:
```bash
queuectl status
```

### Persistence Test

1. Enqueue several jobs:
```bash
queuectl enqueue '{"id":"persist1","command":"echo Test"}'
queuectl enqueue '{"id":"persist2","command":"sleep 10"}'
```

2. Check status:
```bash
queuectl status
```

3. Start a worker and immediately stop it (Ctrl+C)

4. Check status again - jobs should still exist in the database:
```bash
queuectl status
queuectl list
```

### Invalid Command Test

1. Start a worker

2. Enqueue a job with invalid command:
```bash
queuectl enqueue '{"id":"invalid1","command":"nonexistent-command"}'
```

3. Watch worker logs - should fail gracefully and retry

4. After retries exhausted, check DLQ:
```bash
queuectl dlq list
```

## Assumptions & Trade-offs

### Assumptions

1. **Single Database Instance**: All workers connect to the same Supabase database
2. **Job Locking**: Row-level locking prevents duplicate job execution
3. **Command Execution**: Jobs execute shell commands via Node.js `child_process.exec`
4. **Timeout**: Jobs have a 5-minute (300s) execution timeout
5. **Polling Interval**: Workers poll for new jobs every 1 second
6. **Heartbeat**: Workers send heartbeats every 5 seconds

### Trade-offs

1. **Polling vs Push**: Used polling for simplicity; production systems might use Postgres LISTEN/NOTIFY
2. **Lock Expiration**: No automatic lock expiration; crashed workers require manual cleanup
3. **Job Priority**: FIFO queue; no priority-based execution (bonus feature not implemented)
4. **Concurrency**: Simple optimistic locking; high-concurrency scenarios might need more sophisticated approaches
5. **Error Handling**: Basic error capture; production systems might need structured error logging
6. **Metrics**: Basic stats only; no detailed metrics dashboard (bonus feature)

### Simplifications

1. **Authentication**: Uses service role key for all operations (secure for CLI use)
2. **Validation**: Minimal input validation; production would need comprehensive validation
3. **Monitoring**: Basic console logging; production would use structured logging
4. **Testing**: Manual test scenarios; production would have automated test suite

## Key Design Decisions

### Why Supabase?

- **Persistence**: PostgreSQL ensures job data survives restarts
- **ACID Transactions**: Reliable job state transitions
- **Row-Level Security**: Built-in security model
- **Scalability**: Can handle multiple concurrent workers

### Why Exponential Backoff?

Prevents overwhelming failing systems:
- `delay = base ^ attempts` seconds
- Default: 2^1 = 2s, 2^2 = 4s, 2^3 = 8s
- Configurable base allows tuning

### Why Graceful Shutdown?

Prevents job corruption:
- Workers finish current job before stopping
- No partial job execution
- Clean state transitions

### Why Job Locking?

Prevents duplicate execution:
- Optimistic locking with `locked_by` field
- Only one worker can lock a pending job
- Lock released on completion or failure

## Project Structure

```
queuectl/
├── queuectl.js          # Main CLI entry point
├── src/
│   ├── db.js           # Supabase client and config operations
│   ├── job.js          # Job CRUD operations and state management
│   └── worker.js       # Worker process and job execution logic
├── supabase/
│   └── migrations/     # Database schema migrations
├── package.json        # Node.js dependencies and scripts
├── .env               # Supabase connection configuration
└── README.md          # This file
```

## Advanced Usage

### Custom Retry Configuration

Set different retry policies for different job types:
```bash
# High-priority job with more retries
queuectl enqueue '{"id":"important","command":"critical-task","max_retries":10}'

# Quick-fail job
queuectl enqueue '{"id":"quick","command":"fast-task","max_retries":1}'
```

### Worker Scaling

Scale workers based on queue depth:
```bash
# Check pending jobs
queuectl list --state pending

# If many pending, start more workers
queuectl worker start --count 5
```

### Monitoring Workers

Keep workers running with process managers:
```bash
# Using nohup
nohup queuectl worker start --count 3 > worker.log 2>&1 &

# Using systemd (create service file)
# Or use PM2, forever, etc.
```

## Troubleshooting

### Jobs stuck in "processing"

This happens when a worker crashes mid-job:
```bash
# Check for stale locks (manual query needed)
# Reset stuck jobs by updating their state back to pending
```

### Database connection errors

Verify `.env` configuration:
```bash
cat .env
# Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

### Workers not processing jobs

1. Check worker is running: `queuectl status`
2. Check for pending jobs: `queuectl list --state pending`
3. Check worker logs for errors
4. Verify database connectivity

### DLQ jobs not retrying

Jobs in DLQ require manual intervention:
```bash
queuectl dlq list
queuectl dlq retry <job-id>
```

## Contributing

This is an internship assignment project. For production use, consider adding:

- Automated testing suite
- Job timeout handling
- Job priority queues
- Scheduled/delayed jobs (partially implemented)
- Web dashboard for monitoring
- Metrics and execution stats
- Lock expiration and recovery
- Structured logging
- Health check endpoints

## License

MIT

## Demo Video

[Link to demo video showing CLI operations]
"# QueueCTL---Backend-Developer-Internship-Assignment" 
