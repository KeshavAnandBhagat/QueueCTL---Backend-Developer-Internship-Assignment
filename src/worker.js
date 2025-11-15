import { exec } from 'child_process';
import { promisify } from 'util';
import { getSupabase, getConfig } from './db.js';
import {
  getNextPendingJob,
  lockJob,
  markJobCompleted,
  markJobFailed,
  requeueFailedJob,
  updateJob
} from './job.js';

const execAsync = promisify(exec);

export class Worker {
  constructor(workerId) {
    this.workerId = workerId;
    this.isRunning = false;
    this.currentJob = null;
    this.heartbeatInterval = null;
    this.pollInterval = null;
  }

  async start() {
    const supabase = getSupabase();

    await supabase.from('workers').upsert({
      id: this.workerId,
      status: 'active',
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString()
    });

    this.isRunning = true;
    console.log(`[Worker ${this.workerId}] Started`);

    this.heartbeatInterval = setInterval(() => this.updateHeartbeat(), 5000);

    this.pollInterval = setInterval(() => this.processNextJob(), 1000);
    await this.processNextJob();
  }

  async updateHeartbeat() {
    if (!this.isRunning) return;

    const supabase = getSupabase();
    await supabase
      .from('workers')
      .update({
        last_heartbeat: new Date().toISOString(),
        current_job_id: this.currentJob?.id || null
      })
      .eq('id', this.workerId);
  }

  async processNextJob() {
    if (!this.isRunning || this.currentJob) return;

    try {
      const job = await getNextPendingJob();
      if (!job) return;

      const lockedJob = await lockJob(job.id, this.workerId);
      if (!lockedJob) return;

      this.currentJob = lockedJob;
      console.log(`[Worker ${this.workerId}] Processing job ${job.id}: ${job.command}`);

      await this.executeJob(lockedJob);
    } catch (error) {
      console.error(`[Worker ${this.workerId}] Error processing job:`, error.message);
    } finally {
      this.currentJob = null;
    }
  }

  async executeJob(job) {
    try {
      const { stdout, stderr } = await execAsync(job.command, {
        timeout: 300000,
        shell: '/bin/sh'
      });

      const output = stdout || stderr || 'Command executed successfully';
      await markJobCompleted(job.id, output);
      console.log(`[Worker ${this.workerId}] Job ${job.id} completed`);
    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  async handleJobFailure(job, error) {
    const attempts = job.attempts + 1;
    const maxRetries = job.max_retries;
    const errorMessage = error.message || 'Unknown error';

    console.log(`[Worker ${this.workerId}] Job ${job.id} failed (attempt ${attempts}/${maxRetries}): ${errorMessage}`);

    await markJobFailed(job.id, errorMessage, attempts, maxRetries);

    if (attempts < maxRetries) {
      const backoffBase = parseInt(await getConfig('backoff_base')) || 2;
      const delaySeconds = Math.pow(backoffBase, attempts);

      console.log(`[Worker ${this.workerId}] Job ${job.id} will retry in ${delaySeconds}s`);

      setTimeout(async () => {
        try {
          await requeueFailedJob(job.id);
          console.log(`[Worker ${this.workerId}] Job ${job.id} requeued`);
        } catch (err) {
          console.error(`[Worker ${this.workerId}] Failed to requeue job ${job.id}:`, err.message);
        }
      }, delaySeconds * 1000);
    } else {
      console.log(`[Worker ${this.workerId}] Job ${job.id} moved to DLQ`);
    }
  }

  async stop() {
    console.log(`[Worker ${this.workerId}] Stopping...`);
    this.isRunning = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    while (this.currentJob) {
      console.log(`[Worker ${this.workerId}] Waiting for current job to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const supabase = getSupabase();
    await supabase
      .from('workers')
      .update({ status: 'stopped' })
      .eq('id', this.workerId);

    console.log(`[Worker ${this.workerId}] Stopped`);
  }
}

export async function getActiveWorkers() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .eq('status', 'active');

  if (error) throw error;
  return data || [];
}

export async function stopAllWorkers() {
  const supabase = getSupabase();
  await supabase
    .from('workers')
    .update({ status: 'stopped' })
    .eq('status', 'active');
}
