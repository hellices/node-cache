/**
 * 서버 측 GC 지연 분석 벤치마크
 * 목적: 캐시 사용으로 서버의 객체 생성을 줄여 GC 빈도/지연을 최소화
 * 실행: node scripts/benchmark-gc.js
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
const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS || '20');
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '100');

function getRandomService() {
  return SERVICES[Math.floor(Math.random() * SERVICES.length)];
}

async function sendRequests(endpoint, iterations, concurrency) {
  const totalCalls = iterations * concurrency;
  const startTime = Date.now();
  
  for (let batch = 0; batch < iterations; batch++) {
    const promises = [];
    for (let i = 0; i < concurrency; i++) {
      const service = getRandomService();
      promises.push(fetch(`${BASE_URL}${endpoint}/${service}`).catch(() => null));
    }
    await Promise.all(promises);
    process.stdout.write(`\r  Batch ${batch + 1}/${iterations} | Calls: ${(batch + 1) * concurrency}`);
  }
  
  const duration = Date.now() - startTime;
  return { totalCalls, duration };
}

async function runGCBenchmark() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         서버 측 GC 지연 분석: 캐시 vs DB 직접 조회                    ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log('║  목적: 객체 생성 감소 → GC 빈도/지연 최소화                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Server: ${BASE_URL}`);
  console.log(`  Iterations: ${ITERATIONS} × Concurrency: ${CONCURRENCY} = ${ITERATIONS * CONCURRENCY} total calls`);
  
  // Health check
  try {
    const health = await fetch(`${BASE_URL}/health`);
    const healthData = await health.json();
    console.log(`  Server Status: ${healthData.status}`);
    console.log(`  Cache Enabled: ${healthData.cacheEnabled}\n`);
  } catch (error) {
    console.error('  ❌ Server not reachable:', error.message);
    process.exit(1);
  }
  
  // ==================== DB 직접 조회 ====================
  console.log('━'.repeat(75));
  console.log('  [1/2] DB 직접 조회 (매 요청마다 객체 생성)');
  console.log('━'.repeat(75));
  
  await fetch(`${BASE_URL}/api/metrics/reset`, { method: 'POST' }).catch(() => {});
  const dbResult = await sendRequests('/api/v1/abtest/db', ITERATIONS, CONCURRENCY);
  const dbMetrics = await fetch(`${BASE_URL}/api/metrics/memory`).then(r => r.json()).catch(() => null);
  console.log('\n');
  
  // ==================== 캐시 워밍업 ====================
  console.log('  캐시 워밍업...');
  for (const svc of SERVICES) {
    await fetch(`${BASE_URL}/api/v1/abtest/cache/${svc}`).catch(() => {});
  }
  
  // ==================== 인메모리 캐시 ====================
  console.log('━'.repeat(75));
  console.log('  [2/2] 인메모리 캐시 (객체 재사용)');
  console.log('━'.repeat(75));
  
  await fetch(`${BASE_URL}/api/metrics/reset`, { method: 'POST' }).catch(() => {});
  const cacheResult = await sendRequests('/api/v1/abtest/cache', ITERATIONS, CONCURRENCY);
  const cacheMetrics = await fetch(`${BASE_URL}/api/metrics/memory`).then(r => r.json()).catch(() => null);
  console.log('\n');
  
  // ==================== 결과 출력 ====================
  if (!dbMetrics || !cacheMetrics) {
    console.error('  ❌ 서버 메트릭을 가져올 수 없습니다.');
    process.exit(1);
  }
  
  const totalCalls = ITERATIONS * CONCURRENCY;
  const dbRPS = totalCalls / dbResult.duration * 1000;
  const cacheRPS = totalCalls / cacheResult.duration * 1000;
  
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                    서버 측 GC 분석 결과                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                      GC 이벤트 비교                                   │');
  console.log('├────────────────────┬───────────────┬───────────────┬──────────────────┤');
  console.log('│ 지표               │ DB 직접 조회  │ 캐시 사용      │ 절감            │');
  console.log('├────────────────────┼───────────────┼───────────────┼──────────────────┤');
  
  const gcSaved = dbMetrics.gc.totalCount - cacheMetrics.gc.totalCount;
  const minorSaved = dbMetrics.gc.minorCount - cacheMetrics.gc.minorCount;
  const majorSaved = dbMetrics.gc.majorCount - cacheMetrics.gc.majorCount;
  const incSaved = (dbMetrics.gc.incrementalCount || 0) - (cacheMetrics.gc.incrementalCount || 0);
  const weakSaved = (dbMetrics.gc.weakCallbackCount || 0) - (cacheMetrics.gc.weakCallbackCount || 0);
  
  console.log(`│ 총 GC 횟수         │ ${String(dbMetrics.gc.totalCount).padStart(13)} │ ${String(cacheMetrics.gc.totalCount).padStart(13)} │ ${String(gcSaved).padStart(13)} 회 │`);
  console.log(`│  ├ Minor           │ ${String(dbMetrics.gc.minorCount).padStart(13)} │ ${String(cacheMetrics.gc.minorCount).padStart(13)} │ ${String(minorSaved).padStart(13)} 회 │`);
  console.log(`│  ├ Major           │ ${String(dbMetrics.gc.majorCount).padStart(13)} │ ${String(cacheMetrics.gc.majorCount).padStart(13)} │ ${String(majorSaved).padStart(13)} 회 │`);
  console.log(`│  ├ Incremental     │ ${String(dbMetrics.gc.incrementalCount || 0).padStart(13)} │ ${String(cacheMetrics.gc.incrementalCount || 0).padStart(13)} │ ${String(incSaved).padStart(13)} 회 │`);
  console.log(`│  └ WeakCallback    │ ${String(dbMetrics.gc.weakCallbackCount || 0).padStart(13)} │ ${String(cacheMetrics.gc.weakCallbackCount || 0).padStart(13)} │ ${String(weakSaved).padStart(13)} 회 │`);
  console.log(`│ 총 GC 지연         │ ${dbMetrics.gc.totalDuration.padStart(13)} │ ${cacheMetrics.gc.totalDuration.padStart(13)} │                  │`);
  console.log(`│ 해제된 메모리      │ ${(dbMetrics.gc.totalFreedMB || '0 MB').padStart(13)} │ ${(cacheMetrics.gc.totalFreedMB || '0 MB').padStart(13)} │                  │`);
  console.log(`│ GC당 평균 해제     │ ${(dbMetrics.gc.avgFreedPerGC || '0 KB').padStart(13)} │ ${(cacheMetrics.gc.avgFreedPerGC || '0 KB').padStart(13)} │                  │`);
  console.log('└────────────────────┴───────────────┴───────────────┴──────────────────┘');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                      처리량 비교                                      │');
  console.log('├────────────────────┬───────────────┬───────────────┬──────────────────┤');
  console.log('│ 지표               │ DB 직접 조회  │ 캐시 사용      │ 개선            │');
  console.log('├────────────────────┼───────────────┼───────────────┼──────────────────┤');
  console.log(`│ 소요 시간          │ ${(dbResult.duration + ' ms').padStart(13)} │ ${(cacheResult.duration + ' ms').padStart(13)} │ ${((1 - cacheResult.duration / dbResult.duration) * 100).toFixed(0).padStart(13)} % │`);
  console.log(`│ 처리량 (RPS)       │ ${dbRPS.toFixed(0).padStart(13)} │ ${cacheRPS.toFixed(0).padStart(13)} │ ${(cacheRPS / dbRPS).toFixed(1).padStart(13)} x │`);
  console.log(`│ 평균 응답 시간     │ ${dbMetrics.requests.db.avgTime.padStart(13)} │ ${cacheMetrics.requests.cache.avgTime.padStart(13)} │                  │`);
  console.log('└────────────────────┴───────────────┴───────────────┴──────────────────┘');
  
  // 결론
  console.log('\n' + '═'.repeat(75));
  console.log('                              결론');
  console.log('═'.repeat(75));
  
  const minorReduction = dbMetrics.gc.minorCount > 0 
    ? ((1 - cacheMetrics.gc.minorCount / dbMetrics.gc.minorCount) * 100).toFixed(0)
    : 'N/A';
  
  console.log(`\n  ✅ Minor GC: ${dbMetrics.gc.minorCount} → ${cacheMetrics.gc.minorCount} (${minorReduction}% 감소)`);
  console.log(`  ✅ Major GC: ${dbMetrics.gc.majorCount} → ${cacheMetrics.gc.majorCount}`);
  console.log(`  ✅ 해제된 메모리: ${dbMetrics.gc.totalFreedMB || '0 MB'} → ${cacheMetrics.gc.totalFreedMB || '0 MB'}`);
  console.log(`  ✅ 처리량: ${(cacheRPS / dbRPS).toFixed(1)}x 향상`);
  console.log(`  ✅ 평균 응답: ${dbMetrics.requests.db.avgTime} → ${cacheMetrics.requests.cache.avgTime}`);
  
  if (gcSaved > 0) {
    console.log(`\n  🎯 캐시 사용으로 서버 측 객체 생성이 줄어 GC 빈도가 ${gcSaved}회 감소했습니다.`);
  }
  
  console.log('\n' + '═'.repeat(75));
}

runGCBenchmark().catch(console.error);
