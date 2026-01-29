/**
 * 벤치마크 스크립트: DB 직접 조회 vs 캐시 조회 성능 비교
 */
require('dotenv').config();

const SERVICES = [
  'GalaxyStore', 'SamsungHealth', 'SmartThings', 'SamsungPay',
  'Bixby', 'SamsungMembers', 'GalaxyWearable', 'SamsungNotes',
  'GalaxyBuds', 'OneUI', 'SamsungInternet', 'SamsungCalendar',
  'SamsungMessages', 'SamsungGallery', 'SamsungMusic', 'SamsungVideo',
  'SamsungCloud', 'SamsungPass', 'SamsungFlow', 'SamsungDeX'
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS || '100');
const WARMUP_ITERATIONS = 10;

async function fetchWithTiming(url) {
  const start = process.hrtime.bigint();
  const response = await fetch(url);
  const data = await response.json();
  const end = process.hrtime.bigint();
  
  return {
    durationMs: Number(end - start) / 1_000_000,
    serverDurationMs: parseFloat(data.durationMs),
    source: data.source
  };
}

async function runBenchmark() {
  console.log('='.repeat(60));
  console.log('AB Test Cache Benchmark');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Services: ${SERVICES.length}`);
  console.log('');
  
  // Health check
  try {
    const health = await fetch(`${BASE_URL}/health`);
    const healthData = await health.json();
    console.log(`Server Status: ${healthData.status}`);
    console.log(`Cache Enabled: ${healthData.cacheEnabled}`);
  } catch (error) {
    console.error('Server not reachable:', error.message);
    process.exit(1);
  }
  
  // Warmup
  console.log('\n--- Warmup ---');
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const service = SERVICES[i % SERVICES.length];
    await fetchWithTiming(`${BASE_URL}/api/v1/abtest/db/${service}`);
    await fetchWithTiming(`${BASE_URL}/api/v1/abtest/cache/${service}`);
  }
  console.log(`Warmup completed (${WARMUP_ITERATIONS} iterations)`);
  
  // Benchmark DB
  console.log('\n--- Benchmark: DB Direct ---');
  const dbResults = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const service = SERVICES[i % SERVICES.length];
    const result = await fetchWithTiming(`${BASE_URL}/api/v1/abtest/db/${service}`);
    dbResults.push(result);
    
    if ((i + 1) % 20 === 0) {
      process.stdout.write(`Progress: ${i + 1}/${ITERATIONS}\r`);
    }
  }
  console.log('');
  
  // Benchmark Cache
  console.log('\n--- Benchmark: In-Memory Cache ---');
  const cacheResults = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const service = SERVICES[i % SERVICES.length];
    const result = await fetchWithTiming(`${BASE_URL}/api/v1/abtest/cache/${service}`);
    cacheResults.push(result);
    
    if ((i + 1) % 20 === 0) {
      process.stdout.write(`Progress: ${i + 1}/${ITERATIONS}\r`);
    }
  }
  console.log('');
  
  // Calculate statistics
  const calcStats = (results) => {
    const durations = results.map(r => r.durationMs);
    const serverDurations = results.map(r => r.serverDurationMs);
    
    durations.sort((a, b) => a - b);
    serverDurations.sort((a, b) => a - b);
    
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const avg = (arr) => sum(arr) / arr.length;
    const p50 = (arr) => arr[Math.floor(arr.length * 0.5)];
    const p95 = (arr) => arr[Math.floor(arr.length * 0.95)];
    const p99 = (arr) => arr[Math.floor(arr.length * 0.99)];
    
    return {
      client: {
        avg: avg(durations).toFixed(3),
        min: Math.min(...durations).toFixed(3),
        max: Math.max(...durations).toFixed(3),
        p50: p50(durations).toFixed(3),
        p95: p95(durations).toFixed(3),
        p99: p99(durations).toFixed(3)
      },
      server: {
        avg: avg(serverDurations).toFixed(3),
        min: Math.min(...serverDurations).toFixed(3),
        max: Math.max(...serverDurations).toFixed(3),
        p50: p50(serverDurations).toFixed(3),
        p95: p95(serverDurations).toFixed(3),
        p99: p99(serverDurations).toFixed(3)
      }
    };
  };
  
  const dbStats = calcStats(dbResults);
  const cacheStats = calcStats(cacheResults);
  
  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS (all times in ms)');
  console.log('='.repeat(60));
  
  console.log('\n--- Client-side Latency (including network) ---');
  console.log('Metric     | DB Direct   | Cache       | Improvement');
  console.log('-'.repeat(55));
  console.log(`Average    | ${dbStats.client.avg.padStart(10)} | ${cacheStats.client.avg.padStart(10)} | ${((1 - parseFloat(cacheStats.client.avg) / parseFloat(dbStats.client.avg)) * 100).toFixed(1)}%`);
  console.log(`P50        | ${dbStats.client.p50.padStart(10)} | ${cacheStats.client.p50.padStart(10)} | ${((1 - parseFloat(cacheStats.client.p50) / parseFloat(dbStats.client.p50)) * 100).toFixed(1)}%`);
  console.log(`P95        | ${dbStats.client.p95.padStart(10)} | ${cacheStats.client.p95.padStart(10)} | ${((1 - parseFloat(cacheStats.client.p95) / parseFloat(dbStats.client.p95)) * 100).toFixed(1)}%`);
  console.log(`P99        | ${dbStats.client.p99.padStart(10)} | ${cacheStats.client.p99.padStart(10)} | ${((1 - parseFloat(cacheStats.client.p99) / parseFloat(dbStats.client.p99)) * 100).toFixed(1)}%`);
  
  console.log('\n--- Server-side Processing Time ---');
  console.log('Metric     | DB Direct   | Cache       | Improvement');
  console.log('-'.repeat(55));
  console.log(`Average    | ${dbStats.server.avg.padStart(10)} | ${cacheStats.server.avg.padStart(10)} | ${((1 - parseFloat(cacheStats.server.avg) / parseFloat(dbStats.server.avg)) * 100).toFixed(1)}%`);
  console.log(`P50        | ${dbStats.server.p50.padStart(10)} | ${cacheStats.server.p50.padStart(10)} | ${((1 - parseFloat(cacheStats.server.p50) / parseFloat(dbStats.server.p50)) * 100).toFixed(1)}%`);
  console.log(`P95        | ${dbStats.server.p95.padStart(10)} | ${cacheStats.server.p95.padStart(10)} | ${((1 - parseFloat(cacheStats.server.p95) / parseFloat(dbStats.server.p95)) * 100).toFixed(1)}%`);
  console.log(`P99        | ${dbStats.server.p99.padStart(10)} | ${cacheStats.server.p99.padStart(10)} | ${((1 - parseFloat(cacheStats.server.p99) / parseFloat(dbStats.server.p99)) * 100).toFixed(1)}%`);
  
  // Memory usage
  console.log('\n--- Memory Usage ---');
  const memResponse = await fetch(`${BASE_URL}/api/metrics/memory`);
  const memData = await memResponse.json();
  console.log(`Heap Used: ${memData.memory.heapUsed}`);
  console.log(`Heap Total: ${memData.memory.heapTotal}`);
  console.log(`RSS: ${memData.memory.rss}`);
  
  // GC stats
  console.log('\n--- GC Stats ---');
  console.log(`GC Count: ${memData.gc.totalCount} (Minor: ${memData.gc.minorCount}, Major: ${memData.gc.majorCount})`);
  console.log(`GC Total Time: ${memData.gc.totalDuration}`);
  console.log(`GC per Minute: ${memData.gc.gcPerMinute}`);
  
  // Cache stats
  console.log('\n--- Cache Stats ---');
  const statsResponse = await fetch(`${BASE_URL}/api/admin/cache/stats`);
  const statsData = await statsResponse.json();
  console.log(`Cache Size: ${statsData.cacheSize}`);
  console.log(`Hits: ${statsData.hits}`);
  console.log(`Misses: ${statsData.misses}`);
  console.log(`Invalidations: ${statsData.invalidations}`);
  
  console.log('\n' + '='.repeat(60));
}

runBenchmark().catch(console.error);
