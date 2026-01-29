/**
 * GC 스트레스 테스트 - 병렬 호출, 메모리/GC 분석
 * 실행: node --max-old-space-size=128 --expose-gc scripts/gc-stress-test.js
 */
require('dotenv').config();

if (!global.gc) {
  console.error('❌ Run with: node --max-old-space-size=128 --expose-gc scripts/gc-stress-test.js');
  process.exit(1);
}

const { PerformanceObserver } = require('perf_hooks');

// 설정
const ITERATIONS = parseInt(process.env.ITERATIONS || '100');  // 총 반복 횟수
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '50'); // 동시 요청 수
const SERVICES = [
  'GalaxyStore', 'SamsungHealth', 'SmartThings', 'SamsungPay',
  'Bixby', 'SamsungMembers', 'GalaxyWearable', 'SamsungNotes',
  'GalaxyBuds', 'OneUI', 'SamsungInternet', 'SamsungCalendar',
  'SamsungMessages', 'SamsungGallery', 'SamsungMusic', 'SamsungVideo',
  'SamsungCloud', 'SamsungPass', 'SamsungFlow', 'SamsungDeX'
];

// GC 이벤트 수집
let gcEvents = [];
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'gc') {
      gcEvents.push({
        kind: entry.detail?.kind || entry.kind,
        duration: entry.duration,
        timestamp: Date.now()
      });
    }
  }
});
obs.observe({ entryTypes: ['gc'] });

function formatBytes(bytes) {
  if (bytes < 0) return '-' + formatBytes(-bytes);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function analyzeGC(events) {
  const minor = events.filter(e => e.kind === 1);
  const major = events.filter(e => e.kind === 2);
  const incremental = events.filter(e => e.kind === 4 || e.kind === 8);
  
  return {
    total: events.length,
    minor: {
      count: minor.length,
      totalDuration: minor.reduce((a, b) => a + b.duration, 0),
      avgDuration: minor.length > 0 ? minor.reduce((a, b) => a + b.duration, 0) / minor.length : 0,
      maxDuration: minor.length > 0 ? Math.max(...minor.map(e => e.duration)) : 0
    },
    major: {
      count: major.length,
      totalDuration: major.reduce((a, b) => a + b.duration, 0),
      avgDuration: major.length > 0 ? major.reduce((a, b) => a + b.duration, 0) / major.length : 0,
      maxDuration: major.length > 0 ? Math.max(...major.map(e => e.duration)) : 0
    },
    incremental: {
      count: incremental.length,
      totalDuration: incremental.reduce((a, b) => a + b.duration, 0)
    },
    totalDuration: events.reduce((a, b) => a + b.duration, 0)
  };
}

async function runParallelTest(name, testFn) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`  Iterations: ${ITERATIONS} | Concurrency: ${CONCURRENCY} | Total Calls: ${ITERATIONS * CONCURRENCY}`);
  console.log('═'.repeat(70));
  
  // GC 이벤트 초기화
  gcEvents = [];
  
  // 강제 GC로 초기 상태 정리
  global.gc();
  await new Promise(r => setTimeout(r, 100));
  global.gc();
  await new Promise(r => setTimeout(r, 50));
  
  const startMem = process.memoryUsage();
  const startTime = Date.now();
  
  let maxHeap = startMem.heapUsed;
  let totalCalls = 0;
  
  // 병렬 실행
  for (let batch = 0; batch < ITERATIONS; batch++) {
    // 동시에 CONCURRENCY 개의 요청 실행
    const promises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const service = SERVICES[(batch * CONCURRENCY + i) % SERVICES.length];
      promises.push(testFn(service));
    }
    await Promise.all(promises);
    totalCalls += CONCURRENCY;
    
    const mem = process.memoryUsage();
    maxHeap = Math.max(maxHeap, mem.heapUsed);
    
    process.stdout.write(`\r  Batch ${batch + 1}/${ITERATIONS} | Calls: ${totalCalls} | Heap: ${formatBytes(mem.heapUsed)} | GC: ${gcEvents.length} (Minor: ${gcEvents.filter(e => e.kind === 1).length}, Major: ${gcEvents.filter(e => e.kind === 2).length})`);
  }
  
  const endTime = Date.now();
  const endMem = process.memoryUsage();
  
  // GC 분석
  const gcAnalysis = analyzeGC(gcEvents);
  
  // 최종 GC
  global.gc();
  await new Promise(r => setTimeout(r, 50));
  const afterGCMem = process.memoryUsage();
  
  console.log('\n');
  
  return {
    name,
    duration: endTime - startTime,
    totalCalls,
    memory: {
      start: startMem.heapUsed,
      end: endMem.heapUsed,
      max: maxHeap,
      afterGC: afterGCMem.heapUsed,
      growth: endMem.heapUsed - startMem.heapUsed,
      allocPerRequest: (endMem.heapUsed - startMem.heapUsed) / totalCalls
    },
    gc: gcAnalysis
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║           GC Stress Test - Parallel Calls / Memory Analysis          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  const v8 = require('v8');
  const heapStats = v8.getHeapStatistics();
  console.log(`  Heap Limit: ${formatBytes(heapStats.heap_size_limit)}`);
  console.log(`  Iterations: ${ITERATIONS} × Concurrency: ${CONCURRENCY} = ${ITERATIONS * CONCURRENCY} total calls`);
  
  // DB 모듈 로드
  const db = require('../src/config/database');
  const abTestRepository = require('../src/repository/ABTestRepository');
  
  // 캐시 초기화
  process.env.ABTEST_CACHE_ENABLED = 'true';
  const abTestCache = require('../src/services/ABTestCache');
  
  console.log('\n--- Initializing ---');
  await db.testConnection();
  console.log('  DB connected');
  
  await abTestCache.initialize();
  console.log('  Cache initialized');
  
  // ===========================================
  // 테스트 1: DB 직접 조회 (매번 쿼리 + 변환)
  // ===========================================
  const dbResult = await runParallelTest('DB Direct Query (No Cache)', async (service) => {
    const meeGroup = await abTestRepository.getMeeGroupId(service);
    const tests = await abTestRepository.getABTestsByService(service);
    const testIds = tests.map(t => t.ab_test_id);
    const variants = testIds.length > 0 
      ? await abTestRepository.getVariantsByTestIds(testIds)
      : [];
    
    // 매번 변환 수행 (GC 압력의 주 원인)
    return {
      meeGroupId: meeGroup[0]?.mee_group_id,
      tests: tests.map(test => ({
        id: test.ab_test_id,
        name: test.ab_test_nm,
        type: test.ab_test_type,
        status: test.ab_test_status,
        attributeFilter: JSON.parse(test.ab_test_atrb_fltr || '{}'),
        startDate: test.strt_dtm?.toISOString?.() || test.strt_dtm,
        endDate: test.end_dtm?.toISOString?.() || test.end_dtm,
        variants: variants
          .filter(v => v.ab_test_id === test.ab_test_id)
          .map(v => ({
            id: v.vrnt_id,
            key: v.vrnt_key,
            ratio: v.vrnt_ratio,
            payload: JSON.parse(v.vrnt_payload || '{}')
          }))
      }))
    };
  });
  
  // ===========================================
  // 테스트 2: 캐시에서 조회 (변환 없음)
  // ===========================================
  const cacheResult = await runParallelTest('In-Memory Cache (Pre-loaded)', async (service) => {
    const meeGroupId = await abTestCache.getMeeGroupId(service);
    const activeTests = await abTestCache.getActiveTests(service);
    return { meeGroupId, tests: activeTests };
  });
  
  // DB 연결 종료
  await db.close();
  obs.disconnect();
  
  // ===========================================
  // 결과 출력
  // ===========================================
  console.log('\n' + '═'.repeat(70));
  console.log('                              RESULTS');
  console.log('═'.repeat(70));
  
  const totalCalls = ITERATIONS * CONCURRENCY;
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                           Execution                                   │');
  console.log('├──────────────────────┬─────────────────┬─────────────────┬────────────┤');
  console.log('│ Metric               │ DB Direct       │ Cache           │ Diff       │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼────────────┤');
  console.log(`│ Duration             │ ${String(dbResult.duration + 'ms').padStart(15)} │ ${String(cacheResult.duration + 'ms').padStart(15)} │ ${((1 - cacheResult.duration / dbResult.duration) * 100).toFixed(0).padStart(8)}% │`);
  console.log(`│ Throughput           │ ${(totalCalls / dbResult.duration * 1000).toFixed(0).padStart(12)}/s │ ${(totalCalls / cacheResult.duration * 1000).toFixed(0).padStart(12)}/s │ ${((totalCalls / cacheResult.duration * 1000) / (totalCalls / dbResult.duration * 1000)).toFixed(1).padStart(7)}x │`);
  console.log('└──────────────────────┴─────────────────┴─────────────────┴────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                           Memory                                      │');
  console.log('├──────────────────────┬─────────────────┬─────────────────┬────────────┤');
  console.log('│ Metric               │ DB Direct       │ Cache           │ Diff       │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼────────────┤');
  console.log(`│ Heap Growth          │ ${formatBytes(dbResult.memory.growth).padStart(15)} │ ${formatBytes(cacheResult.memory.growth).padStart(15)} │ ${(dbResult.memory.growth > 0 ? ((1 - cacheResult.memory.growth / dbResult.memory.growth) * 100).toFixed(0) + '%' : 'N/A').padStart(10)} │`);
  console.log(`│ Max Heap             │ ${formatBytes(dbResult.memory.max).padStart(15)} │ ${formatBytes(cacheResult.memory.max).padStart(15)} │            │`);
  console.log(`│ Alloc/Request        │ ${formatBytes(dbResult.memory.allocPerRequest).padStart(15)} │ ${formatBytes(cacheResult.memory.allocPerRequest).padStart(15)} │            │`);
  console.log('└──────────────────────┴─────────────────┴─────────────────┴────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                      GC - Minor (Scavenge)                            │');
  console.log('├──────────────────────┬─────────────────┬─────────────────┬────────────┤');
  console.log('│ Metric               │ DB Direct       │ Cache           │ Diff       │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼────────────┤');
  console.log(`│ Count                │ ${String(dbResult.gc.minor.count).padStart(15)} │ ${String(cacheResult.gc.minor.count).padStart(15)} │ ${(dbResult.gc.minor.count > 0 ? ((1 - cacheResult.gc.minor.count / dbResult.gc.minor.count) * 100).toFixed(0) + '%' : 'N/A').padStart(10)} │`);
  console.log(`│ Total Time           │ ${(dbResult.gc.minor.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${(cacheResult.gc.minor.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${(dbResult.gc.minor.totalDuration > 0 ? ((1 - cacheResult.gc.minor.totalDuration / dbResult.gc.minor.totalDuration) * 100).toFixed(0) + '%' : 'N/A').padStart(10)} │`);
  console.log(`│ Avg Pause            │ ${(dbResult.gc.minor.avgDuration.toFixed(2) + 'ms').padStart(15)} │ ${(cacheResult.gc.minor.avgDuration.toFixed(2) + 'ms').padStart(15)} │            │`);
  console.log(`│ Max Pause            │ ${(dbResult.gc.minor.maxDuration.toFixed(2) + 'ms').padStart(15)} │ ${(cacheResult.gc.minor.maxDuration.toFixed(2) + 'ms').padStart(15)} │            │`);
  console.log('└──────────────────────┴─────────────────┴─────────────────┴────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                      GC - Major (Mark-Sweep)                          │');
  console.log('├──────────────────────┬─────────────────┬─────────────────┬────────────┤');
  console.log('│ Metric               │ DB Direct       │ Cache           │ Diff       │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼────────────┤');
  console.log(`│ Count                │ ${String(dbResult.gc.major.count).padStart(15)} │ ${String(cacheResult.gc.major.count).padStart(15)} │ ${(dbResult.gc.major.count > 0 ? ((1 - cacheResult.gc.major.count / dbResult.gc.major.count) * 100).toFixed(0) + '%' : 'N/A').padStart(10)} │`);
  console.log(`│ Total Time           │ ${(dbResult.gc.major.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${(cacheResult.gc.major.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${(dbResult.gc.major.totalDuration > 0 ? ((1 - cacheResult.gc.major.totalDuration / dbResult.gc.major.totalDuration) * 100).toFixed(0) + '%' : 'N/A').padStart(10)} │`);
  console.log(`│ Avg Pause            │ ${(dbResult.gc.major.avgDuration.toFixed(2) + 'ms').padStart(15)} │ ${(cacheResult.gc.major.avgDuration.toFixed(2) + 'ms').padStart(15)} │            │`);
  console.log(`│ Max Pause            │ ${(dbResult.gc.major.maxDuration.toFixed(2) + 'ms').padStart(15)} │ ${(cacheResult.gc.major.maxDuration.toFixed(2) + 'ms').padStart(15)} │            │`);
  console.log('└──────────────────────┴─────────────────┴─────────────────┴────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                         GC Summary                                    │');
  console.log('├──────────────────────┬─────────────────┬─────────────────┬────────────┤');
  console.log('│ Metric               │ DB Direct       │ Cache           │ Saved      │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼────────────┤');
  console.log(`│ Total GC Events      │ ${String(dbResult.gc.total).padStart(15)} │ ${String(cacheResult.gc.total).padStart(15)} │ ${String(dbResult.gc.total - cacheResult.gc.total).padStart(10)} │`);
  console.log(`│ Total GC Time        │ ${(dbResult.gc.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${(cacheResult.gc.totalDuration.toFixed(1) + 'ms').padStart(15)} │ ${((dbResult.gc.totalDuration - cacheResult.gc.totalDuration).toFixed(1) + 'ms').padStart(10)} │`);
  console.log(`│ GC Time %            │ ${((dbResult.gc.totalDuration / dbResult.duration * 100).toFixed(1) + '%').padStart(15)} │ ${((cacheResult.gc.totalDuration / cacheResult.duration * 100).toFixed(1) + '%').padStart(15)} │            │`);
  console.log('└──────────────────────┴─────────────────┴─────────────────┴────────────┘');
  
  // Conclusion
  console.log('\n' + '═'.repeat(70));
  console.log('                            CONCLUSION');
  console.log('═'.repeat(70));
  
  const gcReduction = dbResult.gc.total > 0 
    ? ((1 - cacheResult.gc.total / dbResult.gc.total) * 100).toFixed(0) 
    : 0;
  const minorReduction = dbResult.gc.minor.count > 0 
    ? ((1 - cacheResult.gc.minor.count / dbResult.gc.minor.count) * 100).toFixed(0) 
    : 0;
  const majorReduction = dbResult.gc.major.count > 0 
    ? ((1 - cacheResult.gc.major.count / dbResult.gc.major.count) * 100).toFixed(0) 
    : 0;
  const speedup = (totalCalls / cacheResult.duration * 1000) / (totalCalls / dbResult.duration * 1000);
  
  console.log(`\n  ✅ Minor GC: ${dbResult.gc.minor.count} → ${cacheResult.gc.minor.count} (${minorReduction}% 감소)`);
  console.log(`  ✅ Major GC: ${dbResult.gc.major.count} → ${cacheResult.gc.major.count} (${majorReduction}% 감소)`);
  console.log(`  ✅ GC 일시정지: ${dbResult.gc.totalDuration.toFixed(1)}ms → ${cacheResult.gc.totalDuration.toFixed(1)}ms (${(dbResult.gc.totalDuration - cacheResult.gc.totalDuration).toFixed(1)}ms 절약)`);
  console.log(`  ✅ 처리량: ${speedup.toFixed(1)}x 향상`);
  
  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
