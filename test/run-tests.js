import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('=== QueueCTL Test Suite ===\n');

async function runTest(name, fn) {
  try {
    console.log(`Testing: ${name}...`);
    await fn();
    console.log(`✓ ${name} passed\n`);
    return true;
  } catch (error) {
    console.error(`✗ ${name} failed:`, error.message);
    return false;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  if (await runTest('CLI help command', async () => {
    const { stdout } = await execAsync('queuectl --help');
    if (!stdout.includes('CLI-based background job queue system')) {
      throw new Error('Help output missing');
    }
  })) passed++; else failed++;

  if (await runTest('Enqueue job', async () => {
    const { stdout } = await execAsync('queuectl enqueue \'{"id":"test-basic","command":"echo test"}\'');
    if (!stdout.includes('test-basic')) {
      throw new Error('Job not enqueued');
    }
  })) passed++; else failed++;

  if (await runTest('List pending jobs', async () => {
    const { stdout } = await execAsync('queuectl list --state pending');
    if (!stdout.includes('Found') && !stdout.includes('No jobs')) {
      throw new Error('List command failed');
    }
  })) passed++; else failed++;

  if (await runTest('Check status', async () => {
    const { stdout } = await execAsync('queuectl status');
    if (!stdout.includes('Job Queue Status')) {
      throw new Error('Status command failed');
    }
  })) passed++; else failed++;

  if (await runTest('Config list', async () => {
    const { stdout } = await execAsync('queuectl config list');
    if (!stdout.includes('max-retries')) {
      throw new Error('Config list failed');
    }
  })) passed++; else failed++;

  if (await runTest('Config set', async () => {
    await execAsync('queuectl config set max-retries 5');
    const { stdout } = await execAsync('queuectl config get max-retries');
    if (!stdout.includes('5')) {
      throw new Error('Config not updated');
    }
    await execAsync('queuectl config set max-retries 3');
  })) passed++; else failed++;

  if (await runTest('DLQ list', async () => {
    const { stdout } = await execAsync('queuectl dlq list');
    if (!stdout.includes('DLQ') && !stdout.includes('No jobs')) {
      throw new Error('DLQ list failed');
    }
  })) passed++; else failed++;

  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
