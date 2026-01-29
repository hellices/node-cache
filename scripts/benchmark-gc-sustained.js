/**
 * 장시간 지속 GC 분석 벤치마크
 * 목적: Major GC를 유발하기 위해 장시간 트래픽 발생
 * 
 * Major GC 발생 조건:
 * 1. 객체가 Minor GC를 2-3회 생존 → Old Generation 승격
 * 2. Old Generation이 임계치(~80%)에 도달
 * 
 * 실행: node --expose-gc --max-old-space-size=128 scripts/benchmark-gc-sustained.js
 */
require('dotenv').config();

if (!global.gc) {
  console.error('Run with: node --expose-gc scripts/benchmark-gc-sustained.js');
  process.exit(1);
}

const SERVICES = [
  'GalaxyStore', 'SamsungHealth', 'SmartThings', 'SamsungPay',
  'Bixby', 'SamsungMembers', 'GalaxyWearable', 'SamsungNotes',
  'GalaxyBuds', 'OneUI', 'SamsungInternet', 'SamsungCalendar',
  'SamsungMessages', 'SamsungGallery', 'SamsungMusic', 'SamsungVideo',
  'SamsungCloud', 'SamsungPass', 'SamsungFlow', 'SamsungDeX'
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DURATION_SEC = parseInt(process.env.DURATION || '120');  // 기본 2분
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '50');
const INTERVAL_MS = parseInt(process.env.INTERVAL || '100');   // 배치 간격

// 응답을 일시적으로 보관하여 객체가 Minor GC 생존하도록 함
const responseBuffer = [];
const BUFFER_SIZE = 1000;  // 최근 1000개 응답 유지

async function runSustainedTest(endpoint, durationSec) {
  const startTime = Date.now();
  const endTime = startTime + (durationSec * 1000);
  
  const gcEvents = { minor: [], major: [], incremental: [], weak: [] };
  let totalCalls = 0;
  let errors = 0;
  
  const { PerformanceObserver } = require('perf_hooks');
  
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'gc') {
        const kind = entry.detail?.kind || entry.kind || 0;
        const data = { duration: entry.duration, timestamp: Date.now() - startTime };
        switch (kind) {
          case 1: gcEvents.minor.push(data); break;
          case 2: gcEvents.major.push(data); break;
          case 4: gcEvents.incremental.push(data); break;
          case 8: gcEvents.weak.push(data); break;
        }
      }
    }
  });
  
  try {
    obs.observe({ entryTypes: ['gc'] });
  } catch (e) {}
  
  const memorySnapshots = [];
  
  // 메모리 스냅샷 주기적 수집
  const memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    memorySnapshots.push({
      timestamp: Date.now() - startTime,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external
    });
  }, 1000);
  
  console.log(`  시작: ${new Date().toISOString()}`);
  console.log(`  예상 종료: ${new Date(endTime).toISOString()}`);
  console.log('');
  
  while (Date.now() < endTime) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const service = SERVICES[(totalCalls + i) % SERVICES.length];
      batch.push(
        fetch(`${BASE_URL}${endpoint}/${service}`)
          .then(r => r.json())
          .then(data => {
            // 응답을 버퍼에 저장 (객체 수명 연장 → Old Gen 승격 유도)
            responseBuffer.push(data);
            if (responseBuffer.length > BUFFER_SIZE) {
              responseBuffer.shift();  // 가장 오래된 것 제거
            }
            return data;
          })
          .catch(() => { errors++; return null; })
      );
    }
    
    await Promise.all(batch);
    totalCalls += CONCURRENCY;
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.ceil((endTime - Date.now()) / 1000);
    const minorCount = gcEvents.minor.length;
    const majorCount = gcEvents.major.length;
    const mem = process.memoryUsage();
    
    process.stdout.write(
      `\r  [${elapsed}s / ${DURATION_SEC}s] ` +
      `Calls: ${totalCalls} | ` +
      `GC: Minor=${minorCount}, Major=${majorCount} | ` +
      `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB | ` +
      `Buffer: ${responseBuffer.length}`
    );
    
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
  
  clearInterval(memInterval);
  obs.disconnect();
  
  console.log('\n');
  
  return {
    totalCalls,
    errors,
    duration: Date.now() - startTime,
    gcEvents,
    memorySnapshots,
    bufferSize: responseBuffer.length
  };
}

function printResults(label, results) {
  const gc = results.gcEvents;
  const totalGC = gc.minor.length + gc.major.length + gc.incremental.length + gc.weak.length;
  
  console.log(`\n━━━ ${label} ━━━`);
  console.log(`  총 요청: ${results.totalCalls} (에러: ${results.errors})`);
  console.log(`  소요 시간: ${(results.duration / 1000).toFixed(1)}s`);
  console.log(`  처리량: ${(results.totalCalls / results.duration * 1000).toFixed(1)} RPS`);
  console.log('');
  console.log('  GC 이벤트:');
  console.log(`    Minor (Scavenge):    ${gc.minor.length}회, 총 ${gc.minor.reduce((a, b) => a + b.duration, 0).toFixed(1)}ms`);
  console.log(`    Major (Mark-Sweep):  ${gc.major.length}회, 총 ${gc.major.reduce((a, b) => a + b.duration, 0).toFixed(1)}ms`);
  console.log(`    Incremental:         ${gc.incremental.length}회`);
  console.log(`    WeakCallback:        ${gc.weak.length}회`);
  console.log(`    합계:                ${totalGC}회`);
  
  if (gc.major.length > 0) {
    console.log('');
    console.log('  ⚠️ Major GC 발생 시점:');
    gc.major.forEach((m, i) => {
      console.log(`    #${i + 1}: ${(m.timestamp / 1000).toFixed(1)}s 에서 ${m.duration.toFixed(2)}ms`);
    });
  }
  
  // 메모리 추이
  if (results.memorySnapshots.length > 0) {
    const maxHeap = Math.max(...results.memorySnapshots.map(s => s.heapUsed));
    const minHeap = Math.min(...results.memorySnapshots.map(s => s.heapUsed));
    console.log('');
    console.log('  메모리 추이:');
    console.log(`    Min Heap: ${(minHeap / 1024 / 1024).toFixed(1)}MB`);
    console.log(`    Max Heap: ${(maxHeap / 1024 / 1024).toFixed(1)}MB`);
  }
  
  return {
    minor: gc.minor.length,
    major: gc.major.length,
    totalGC,
    minorTime: gc.minor.reduce((a, b) => a + b.duration, 0),
    majorTime: gc.major.reduce((a, b) => a + b.duration, 0)
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║      장시간 지속 GC 분석 (Major GC 유발 테스트)                       ║');
  console.log('╠══════════════════════════════════════════════════════════════════════╣');
  console.log('║  목적: 운영 환경처럼 장시간 트래픽으로 Major GC 발생 관찰             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Duration: ${DURATION_SEC}초 per test`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log(`  Response Buffer: ${BUFFER_SIZE} (객체 수명 연장)`);
  console.log('');
  
  // Health check
  try {
    const health = await fetch(`${BASE_URL}/health`);
    const healthData = await health.json();
    console.log(`  Server Status: ${healthData.status}`);
    console.log(`  Cache Enabled: ${healthData.cacheEnabled}`);
  } catch (error) {
    console.error('  ❌ Server not reachable:', error.message);
    process.exit(1);
  }
  
  console.log('\n');
  
  // Force GC before test
  global.gc();
  responseBuffer.length = 0;
  
  console.log('━'.repeat(75));
  console.log('  [1/2] DB 직접 조회 (매 요청마다 객체 생성)');
  console.log('━'.repeat(75));
  const dbResults = await runSustainedTest('/api/v1/abtest/db', DURATION_SEC);
  const dbStats = printResults('DB 직접 조회', dbResults);
  
  // 버퍼 클리어 및 GC
  responseBuffer.length = 0;
  global.gc();
  await new Promise(r => setTimeout(r, 2000));
  global.gc();
  
  console.log('\n');
  console.log('━'.repeat(75));
  console.log('  [2/2] 인메모리 캐시 (객체 재사용)');
  console.log('━'.repeat(75));
  const cacheResults = await runSustainedTest('/api/v1/abtest/cache', DURATION_SEC);
  const cacheStats = printResults('인메모리 캐시', cacheResults);
  
  // 비교 결과
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         비교 결과                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n┌───────────────────────────────────────────────────────────────────────┐');
  console.log('│                        GC 비교                                        │');
  console.log('├────────────────────┬───────────────┬───────────────┬──────────────────┤');
  console.log('│ 지표               │ DB 직접 조회  │ 캐시 사용      │ 절감            │');
  console.log('├────────────────────┼───────────────┼───────────────┼──────────────────┤');
  console.log(`│ Minor GC           │ ${String(dbStats.minor).padStart(13)} │ ${String(cacheStats.minor).padStart(13)} │ ${((1 - cacheStats.minor / Math.max(1, dbStats.minor)) * 100).toFixed(0).padStart(13)}% │`);
  console.log(`│ Major GC           │ ${String(dbStats.major).padStart(13)} │ ${String(cacheStats.major).padStart(13)} │ ${((1 - cacheStats.major / Math.max(1, dbStats.major)) * 100).toFixed(0).padStart(13)}% │`);
  console.log(`│ 총 GC              │ ${String(dbStats.totalGC).padStart(13)} │ ${String(cacheStats.totalGC).padStart(13)} │ ${(dbStats.totalGC - cacheStats.totalGC).toString().padStart(11)} 회 │`);
  console.log(`│ Minor GC 지연      │ ${(dbStats.minorTime.toFixed(1) + 'ms').padStart(13)} │ ${(cacheStats.minorTime.toFixed(1) + 'ms').padStart(13)} │ ${(dbStats.minorTime - cacheStats.minorTime).toFixed(1).padStart(11)}ms │`);
  console.log(`│ Major GC 지연      │ ${(dbStats.majorTime.toFixed(1) + 'ms').padStart(13)} │ ${(cacheStats.majorTime.toFixed(1) + 'ms').padStart(13)} │ ${(dbStats.majorTime - cacheStats.majorTime).toFixed(1).padStart(11)}ms │`);
  console.log('└────────────────────┴───────────────┴───────────────┴──────────────────┘');
  
  console.log('\n' + '═'.repeat(75));
  console.log('                              결론');
  console.log('═'.repeat(75));
  
  if (dbStats.major > 0 || cacheStats.major > 0) {
    console.log(`\n  ⚠️ Major GC 발생: DB=${dbStats.major}회, Cache=${cacheStats.major}회`);
    if (dbStats.major > cacheStats.major) {
      console.log(`  ✅ 캐시 사용으로 Major GC ${dbStats.major - cacheStats.major}회 감소`);
    }
  } else {
    console.log('\n  ℹ️ Major GC 미발생 - 힙 크기를 줄이거나 테스트 시간을 늘려보세요:');
    console.log('     node --expose-gc --max-old-space-size=64 scripts/benchmark-gc-sustained.js');
  }
  
  console.log('\n' + '═'.repeat(75));
}

main().catch(console.error);
