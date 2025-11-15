#!/usr/bin/env node

import { Command } from 'commander';
import { randomUUID } from 'crypto';
import {
  enqueueJob,
  getJobsByState,
  getAllJobs,
  getJob,
  getJobStats,
  requeueFailedJob,
  JobState
} from './src/job.js';
import { Worker, getActiveWorkers, stopAllWorkers } from './src/worker.js';
import { getConfig, setConfig } from './src/db.js';

const program = new Command();

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

program
  .command('enqueue')
  .description('Add a new job to the queue')
  .argument('<json>', 'Job specification as JSON string')
  .action(async (jsonStr) => {
    try {
      const jobSpec = JSON.parse(jsonStr);

      if (!jobSpec.command) {
        console.error('Error: Job must have a "command" field');
        process.exit(1);
      }

      const job = await enqueueJob({
        id: jobSpec.id || randomUUID(),
        command: jobSpec.command,
        max_retries: jobSpec.max_retries || parseInt(await getConfig('max_retries')) || 3,
        scheduled_at: jobSpec.scheduled_at || null
      });

      console.log('Job enqueued successfully:');
      console.log(JSON.stringify(job, null, 2));
    } catch (error) {
      console.error('Error enqueueing job:', error.message);
      process.exit(1);
    }
  });

const workerCmd = program.command('worker').description('Manage worker processes');

workerCmd
  .command('start')
  .description('Start one or more workers')
  .option('-c, --count <number>', 'Number of workers to start', '1')
  .action(async (options) => {
    try {
      const count = parseInt(options.count);
      if (isNaN(count) || count < 1) {
        console.error('Error: Count must be a positive number');
        process.exit(1);
      }

      const workers = [];

      for (let i = 0; i < count; i++) {
        const workerId = `worker-${randomUUID()}`;
        const worker = new Worker(workerId);
        workers.push(worker);
        await worker.start();
      }

      const shutdown = async () => {
        console.log('\nReceived shutdown signal, stopping workers...');
        await Promise.all(workers.map(w => w.stop()));
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      console.log(`Started ${count} worker(s). Press Ctrl+C to stop.`);

      await new Promise(() => {});
    } catch (error) {
      console.error('Error starting workers:', error.message);
      process.exit(1);
    }
  });

workerCmd
  .command('stop')
  .description('Stop all running workers')
  .action(async () => {
    try {
      await stopAllWorkers();
      console.log('All workers stopped');
    } catch (error) {
      console.error('Error stopping workers:', error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show summary of all job states and active workers')
  .action(async () => {
    try {
      const stats = await getJobStats();
      const workers = await getActiveWorkers();

      console.log('\n=== Job Queue Status ===\n');
      console.log(`Total Jobs:      ${stats.total}`);
      console.log(`Pending:         ${stats.pending}`);
      console.log(`Processing:      ${stats.processing}`);
      console.log(`Completed:       ${stats.completed}`);
      console.log(`Failed:          ${stats.failed}`);
      console.log(`Dead (DLQ):      ${stats.dead}`);
      console.log(`\nActive Workers:  ${workers.length}`);

      if (workers.length > 0) {
        console.log('\n--- Active Workers ---');
        workers.forEach(w => {
          const uptime = Math.floor((Date.now() - new Date(w.started_at).getTime()) / 1000);
          console.log(`  ${w.id.substring(0, 13)}: ${w.current_job_id ? `Processing ${w.current_job_id}` : 'Idle'} (uptime: ${uptime}s)`);
        });
      }

      console.log('');
    } catch (error) {
      console.error('Error fetching status:', error.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List jobs by state')
  .option('-s, --state <state>', 'Filter by job state (pending, processing, completed, failed, dead)', 'all')
  .action(async (options) => {
    try {
      let jobs;
      if (options.state === 'all') {
        jobs = await getAllJobs();
      } else {
        if (!Object.values(JobState).includes(options.state)) {
          console.error(`Error: Invalid state. Must be one of: ${Object.values(JobState).join(', ')}`);
          process.exit(1);
        }
        jobs = await getJobsByState(options.state);
      }

      if (jobs.length === 0) {
        console.log(`No jobs found${options.state !== 'all' ? ` with state: ${options.state}` : ''}`);
        return;
      }

      console.log(`\nFound ${jobs.length} job(s):\n`);
      jobs.forEach(job => {
        console.log(`ID:       ${job.id}`);
        console.log(`Command:  ${job.command}`);
        console.log(`State:    ${job.state}`);
        console.log(`Attempts: ${job.attempts}/${job.max_retries}`);
        console.log(`Created:  ${new Date(job.created_at).toLocaleString()}`);
        if (job.last_error) {
          console.log(`Error:    ${job.last_error}`);
        }
        if (job.output) {
          console.log(`Output:   ${job.output.substring(0, 100)}${job.output.length > 100 ? '...' : ''}`);
        }
        console.log('---');
      });
    } catch (error) {
      console.error('Error listing jobs:', error.message);
      process.exit(1);
    }
  });

const dlqCmd = program.command('dlq').description('Manage Dead Letter Queue');

dlqCmd
  .command('list')
  .description('List jobs in DLQ')
  .action(async () => {
    try {
      const jobs = await getJobsByState(JobState.DEAD);

      if (jobs.length === 0) {
        console.log('No jobs in DLQ');
        return;
      }

      console.log(`\nFound ${jobs.length} job(s) in DLQ:\n`);
      jobs.forEach(job => {
        console.log(`ID:       ${job.id}`);
        console.log(`Command:  ${job.command}`);
        console.log(`Attempts: ${job.attempts}/${job.max_retries}`);
        console.log(`Error:    ${job.last_error}`);
        console.log(`Created:  ${new Date(job.created_at).toLocaleString()}`);
        console.log('---');
      });
    } catch (error) {
      console.error('Error listing DLQ:', error.message);
      process.exit(1);
    }
  });

dlqCmd
  .command('retry')
  .description('Retry a job from DLQ')
  .argument('<job-id>', 'Job ID to retry')
  .action(async (jobId) => {
    try {
      const job = await getJob(jobId);

      if (!job) {
        console.error(`Error: Job ${jobId} not found`);
        process.exit(1);
      }

      if (job.state !== JobState.DEAD) {
        console.error(`Error: Job ${jobId} is not in DLQ (current state: ${job.state})`);
        process.exit(1);
      }

      await requeueFailedJob(jobId);
      console.log(`Job ${jobId} moved back to queue for retry`);
    } catch (error) {
      console.error('Error retrying job:', error.message);
      process.exit(1);
    }
  });

const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (max-retries, backoff-base)')
  .argument('<value>', 'Configuration value')
  .action(async (key, value) => {
    try {
      const normalizedKey = key.replace(/-/g, '_');

      if (!['max_retries', 'backoff_base'].includes(normalizedKey)) {
        console.error('Error: Invalid config key. Must be one of: max-retries, backoff-base');
        process.exit(1);
      }

      if (isNaN(parseInt(value))) {
        console.error('Error: Value must be a number');
        process.exit(1);
      }

      await setConfig(normalizedKey, value);
      console.log(`Configuration updated: ${key} = ${value}`);
    } catch (error) {
      console.error('Error setting config:', error.message);
      process.exit(1);
    }
  });

configCmd
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key (max-retries, backoff-base)')
  .action(async (key) => {
    try {
      const normalizedKey = key.replace(/-/g, '_');

      if (!['max_retries', 'backoff_base'].includes(normalizedKey)) {
        console.error('Error: Invalid config key. Must be one of: max-retries, backoff-base');
        process.exit(1);
      }

      const value = await getConfig(normalizedKey);
      console.log(`${key}: ${value}`);
    } catch (error) {
      console.error('Error getting config:', error.message);
      process.exit(1);
    }
  });

configCmd
  .command('list')
  .description('List all configuration values')
  .action(async () => {
    try {
      const maxRetries = await getConfig('max_retries');
      const backoffBase = await getConfig('backoff_base');

      console.log('\n=== Configuration ===\n');
      console.log(`max-retries:  ${maxRetries}`);
      console.log(`backoff-base: ${backoffBase}`);
      console.log('');
    } catch (error) {
      console.error('Error listing config:', error.message);
      process.exit(1);
    }
  });

program.parse();
