import { getSupabase } from './db.js';

export const JobState = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead'
};

export async function enqueueJob(jobData) {
  const supabase = getSupabase();

  const job = {
    id: jobData.id,
    command: jobData.command,
    state: JobState.PENDING,
    attempts: 0,
    max_retries: jobData.max_retries || 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_at: jobData.scheduled_at || null,
    last_error: null,
    output: null,
    locked_by: null,
    locked_at: null
  };

  const { data, error } = await supabase
    .from('jobs')
    .insert(job)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getJobsByState(state) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('state', state)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getAllJobs() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getJob(jobId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateJob(jobId, updates) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function lockJob(jobId, workerId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      state: JobState.PROCESSING,
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId)
    .eq('state', JobState.PENDING)
    .is('locked_by', null)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getNextPendingJob() {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('state', JobState.PENDING)
    .is('locked_by', null)
    .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function markJobCompleted(jobId, output) {
  return updateJob(jobId, {
    state: JobState.COMPLETED,
    output,
    locked_by: null,
    locked_at: null
  });
}

export async function markJobFailed(jobId, error, attempts, maxRetries) {
  const state = attempts >= maxRetries ? JobState.DEAD : JobState.FAILED;

  return updateJob(jobId, {
    state,
    attempts,
    last_error: error,
    locked_by: null,
    locked_at: null
  });
}

export async function requeueFailedJob(jobId) {
  return updateJob(jobId, {
    state: JobState.PENDING,
    locked_by: null,
    locked_at: null
  });
}

export async function getJobStats() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .select('state');

  if (error) throw error;

  const stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    dead: 0,
    total: data.length
  };

  data.forEach(job => {
    stats[job.state]++;
  });

  return stats;
}
