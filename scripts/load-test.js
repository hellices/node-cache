/**
 * 부하 테스트 스크립트 (autocannon 사용)
 */
const autocannon = require('autocannon');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DURATION = parseInt(process.env.LOAD_TEST_DURATION || '30'); // seconds
const CONNECTIONS = parseInt(process.env.LOAD_TEST_CONNECTIONS || '100');

const SERVICES = [
  'GalaxyStore', 'SamsungHealth', 'SmartThings', 'SamsungPay',
  'Bixby', 'SamsungMembers', 'GalaxyWearable', 'SamsungNotes',
  'GalaxyBuds', 'OneUI', 'SamsungInternet', 'SamsungCalendar',
  'SamsungMessages', 'SamsungGallery', 'SamsungMusic', 'SamsungVideo',
  'SamsungCloud', 'SamsungPass', 'SamsungFlow', 'SamsungDeX'
];

async function runLoadTest(name, paths) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Load Test: ${name}`);
  console.log(`Duration: ${DURATION}s, Connections: ${CONNECTIONS}`);
  console.log('='.repeat(60));
  
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: BASE_URL,
      connections: CONNECTIONS,
      duration: DURATION,
      requests: paths.map(path => ({ path }))
    }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
    
    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function main() {
  console.log('AB Test Cache Load Test');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Services: ${SERVICES.length}`);
  
  // DB Direct load test
  const dbPaths = SERVICES.map(s => `/api/v1/abtest/db/${s}`);
  const dbResult = await runLoadTest('DB Direct', dbPaths);
  
  // Cache load test
  const cachePaths = SERVICES.map(s => `/api/v1/abtest/cache/${s}`);
  const cacheResult = await runLoadTest('In-Memory Cache', cachePaths);
  
  // Compare results
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(60));
  
  console.log('\nMetric                | DB Direct      | Cache          | Improvement');
  console.log('-'.repeat(70));
  console.log(`Requests/sec          | ${dbResult.requests.average.toFixed(2).padStart(14)} | ${cacheResult.requests.average.toFixed(2).padStart(14)} | ${((cacheResult.requests.average / dbResult.requests.average - 1) * 100).toFixed(1)}% faster`);
  console.log(`Throughput (MB/s)     | ${(dbResult.throughput.average / 1024 / 1024).toFixed(2).padStart(14)} | ${(cacheResult.throughput.average / 1024 / 1024).toFixed(2).padStart(14)} |`);
  console.log(`Latency Avg (ms)      | ${dbResult.latency.average.toFixed(2).padStart(14)} | ${cacheResult.latency.average.toFixed(2).padStart(14)} | ${((1 - cacheResult.latency.average / dbResult.latency.average) * 100).toFixed(1)}% lower`);
  console.log(`Latency P99 (ms)      | ${dbResult.latency.p99.toFixed(2).padStart(14)} | ${cacheResult.latency.p99.toFixed(2).padStart(14)} | ${((1 - cacheResult.latency.p99 / dbResult.latency.p99) * 100).toFixed(1)}% lower`);
  console.log(`Errors                | ${String(dbResult.errors).padStart(14)} | ${String(cacheResult.errors).padStart(14)} |`);
  console.log(`Timeouts              | ${String(dbResult.timeouts).padStart(14)} | ${String(cacheResult.timeouts).padStart(14)} |`);
  
  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
