require('dotenv').config();
const express = require('express');
const abTestCache = require('./services/ABTestCache');
const abTestRepository = require('./repository/ABTestRepository');
const db = require('./config/database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// GC 모니터링 설정
// ============================================
const gcStats = {
  totalCount: 0,
  minorCount: 0,
  majorCount: 0,
  incrementalCount: 0,
  weakCallbackCount: 0,
  totalDuration: 0,
  totalFreedBytes: 0,  // GC로 해제된 총 메모리
  lastHeapUsed: 0,
  lastGC: null,
  startTime: Date.now()
};

// GC 이벤트 추적 (--expose-gc 필요)
try {
  const { PerformanceObserver } = require('perf_hooks');
  
  // 초기 힙 사용량 저장
  gcStats.lastHeapUsed = process.memoryUsage().heapUsed;
  
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'gc') {
        const currentHeap = process.memoryUsage().heapUsed;
        const freedBytes = gcStats.lastHeapUsed - currentHeap;
        
        // 실제로 메모리가 해제된 경우만 카운트
        if (freedBytes > 0) {
          gcStats.totalFreedBytes += freedBytes;
        }
        gcStats.lastHeapUsed = currentHeap;
        
        gcStats.totalCount++;
        gcStats.totalDuration += entry.duration;
        gcStats.lastGC = {
          kind: entry.detail?.kind || entry.kind,
          duration: entry.duration,
          freedBytes: freedBytes > 0 ? freedBytes : 0,
          timestamp: Date.now()
        };
        
        const kind = entry.detail?.kind || entry.kind;
        if (kind === 1) gcStats.minorCount++;
        else if (kind === 2) gcStats.majorCount++;
        else if (kind === 4) gcStats.incrementalCount++;
        else if (kind === 8) gcStats.weakCallbackCount++;
      }
    }
  });
  obs.observe({ entryTypes: ['gc'] });
  console.log('[GC Monitor] GC tracking enabled');
} catch (e) {
  console.log('[GC Monitor] GC tracking not available (run with --expose-gc)');
}

// 요청 카운터
const requestStats = {
  dbRequests: 0,
  cacheRequests: 0,
  totalDbTime: 0,
  totalCacheTime: 0
};

// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', cacheEnabled: process.env.ABTEST_CACHE_ENABLED === 'true' });
});

// ============================================
// 1. 원래 로직 (매번 DB에서 조회)
// ============================================
app.get('/api/v1/abtest/db/:service', async (req, res) => {
  try {
    const startTime = process.hrtime.bigint();
    
    const { service } = req.params;
    
    // 매번 DB에서 조회
    const meeGroup = await abTestRepository.getMeeGroupId(service);
    const tests = await abTestRepository.getABTestsByService(service);
    const testIds = tests.map(t => t.ab_test_id);
    const variants = testIds.length > 0 
      ? await abTestRepository.getVariantsByTestIds(testIds)
      : [];
    
    // 매번 변환 수행
    const result = {
      meeGroupId: meeGroup[0]?.mee_group_id,
      tests: tests.map(test => ({
        id: test.ab_test_id,
        name: test.ab_test_nm,
        type: test.ab_test_type,
        status: test.ab_test_status,
        attributeFilter: JSON.parse(test.ab_test_atrb_fltr || '{}'),
        startDate: test.strt_dtm?.toISOString(),
        endDate: test.end_dtm?.toISOString(),
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
    
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;
    
    // 통계 업데이트
    requestStats.dbRequests++;
    requestStats.totalDbTime += durationMs;
    
    res.json({
      source: 'database',
      durationMs: durationMs.toFixed(3),
      data: result
    });
  } catch (error) {
    console.error('DB API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 2. 인메모리 캐시에서 조회
// ============================================
app.get('/api/v1/abtest/cache/:service', async (req, res) => {
  try {
    const startTime = process.hrtime.bigint();
    
    const { service } = req.params;
    
    // 캐시에서 조회 (단일 캐시 조회로 효율화)
    const data = await abTestCache.getData(service);
    
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;
    
    // 통계 업데이트
    requestStats.cacheRequests++;
    requestStats.totalCacheTime += durationMs;
    
    res.json({
      source: 'cache',
      durationMs: durationMs.toFixed(3),
      data: data || { meeGroupId: null, tests: [] }
    });
  } catch (error) {
    console.error('Cache API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Admin API: 캐시 무효화 (직접 캐시 조작)
// ============================================
app.post('/api/admin/cache/invalidate', (req, res) => {
  try {
    const { service, type = 'SERVICE' } = req.body;
    
    if (type === 'ALL') {
      abTestCache.invalidateAll();
      res.json({ message: 'All cache invalidated' });
    } else if (service) {
      abTestCache.invalidate(service);
      res.json({ message: `Cache invalidated for service: ${service}` });
    } else {
      res.status(400).json({ error: 'service or type=ALL required' });
    }
  } catch (error) {
    console.error('Cache invalidation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Admin API: 캐시 상태 조회
// ============================================
app.get('/api/admin/cache/stats', (req, res) => {
  const stats = abTestCache.getStats();
  res.json(stats);
});

// ============================================
// Admin API: 캐시 강제 리로드
// ============================================
app.post('/api/admin/cache/reload', async (req, res) => {
  try {
    await abTestCache.reload();
    res.json({ message: 'Cache reloaded' });
  } catch (error) {
    console.error('Cache reload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 메모리 및 GC 사용량 조회 (GC 분석용)
// ============================================
app.get('/api/metrics/memory', (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = Date.now() - gcStats.startTime;
  
  res.json({
    memory: {
      heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      external: (memUsage.external / 1024 / 1024).toFixed(2) + ' MB',
      rss: (memUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
      raw: memUsage
    },
    gc: {
      totalCount: gcStats.totalCount,
      minorCount: gcStats.minorCount,
      majorCount: gcStats.majorCount,
      incrementalCount: gcStats.incrementalCount,
      weakCallbackCount: gcStats.weakCallbackCount,
      totalDuration: gcStats.totalDuration.toFixed(2) + ' ms',
      totalFreedBytes: gcStats.totalFreedBytes,
      totalFreedMB: (gcStats.totalFreedBytes / 1024 / 1024).toFixed(2) + ' MB',
      avgDuration: gcStats.totalCount > 0 
        ? (gcStats.totalDuration / gcStats.totalCount).toFixed(2) + ' ms'
        : '0 ms',
      avgFreedPerGC: gcStats.totalCount > 0
        ? (gcStats.totalFreedBytes / gcStats.totalCount / 1024).toFixed(2) + ' KB'
        : '0 KB',
      lastGC: gcStats.lastGC,
      gcPerMinute: (gcStats.totalCount / (uptime / 60000)).toFixed(2)
    },
    requests: {
      db: {
        count: requestStats.dbRequests,
        totalTime: requestStats.totalDbTime.toFixed(2) + ' ms',
        avgTime: requestStats.dbRequests > 0 
          ? (requestStats.totalDbTime / requestStats.dbRequests).toFixed(2) + ' ms'
          : '0 ms'
      },
      cache: {
        count: requestStats.cacheRequests,
        totalTime: requestStats.totalCacheTime.toFixed(2) + ' ms',
        avgTime: requestStats.cacheRequests > 0 
          ? (requestStats.totalCacheTime / requestStats.cacheRequests).toFixed(2) + ' ms'
          : '0 ms'
      }
    },
    uptime: {
      ms: uptime,
      formatted: `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`
    }
  });
});

// GC 통계 리셋
app.post('/api/metrics/reset', (req, res) => {
  gcStats.totalCount = 0;
  gcStats.minorCount = 0;
  gcStats.majorCount = 0;
  gcStats.incrementalCount = 0;
  gcStats.weakCallbackCount = 0;
  gcStats.totalDuration = 0;
  gcStats.totalFreedBytes = 0;
  gcStats.lastHeapUsed = process.memoryUsage().heapUsed;
  gcStats.lastGC = null;
  gcStats.startTime = Date.now();
  
  requestStats.dbRequests = 0;
  requestStats.cacheRequests = 0;
  requestStats.totalDbTime = 0;
  requestStats.totalCacheTime = 0;
  
  res.json({ message: 'Metrics reset' });
});

// 강제 GC 트리거 (테스트용)
app.post('/api/metrics/gc', (req, res) => {
  if (global.gc) {
    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;
    res.json({ 
      message: 'GC triggered',
      freed: ((before - after) / 1024 / 1024).toFixed(2) + ' MB',
      heapBefore: (before / 1024 / 1024).toFixed(2) + ' MB',
      heapAfter: (after / 1024 / 1024).toFixed(2) + ' MB'
    });
  } else {
    res.status(400).json({ error: 'GC not exposed. Run server with --expose-gc flag' });
  }
});

// ============================================
// 서버 시작
// ============================================
async function startServer() {
  try {
    // DB 연결 테스트 (MySQL)
    await db.testConnection();
    console.log('MySQL connected');
    
    // 캐시 초기화
    await abTestCache.initialize();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Cache enabled: ${process.env.ABTEST_CACHE_ENABLED === 'true'}`);
      
      // 메모리 제한 정보
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      console.log(`Heap size limit: ${(heapStats.heap_size_limit / 1024 / 1024).toFixed(0)} MB`);
      console.log(`GC tracking: ${global.gc ? 'enabled' : 'disabled (run with --expose-gc)'}`);
      
      console.log('\n--- API Endpoints ---');
      console.log('DB Direct:   GET /api/v1/abtest/db/:service');
      console.log('Cache:       GET /api/v1/abtest/cache/:service');
      console.log('Metrics:     GET /api/metrics/memory');
      console.log('Force GC:    POST /api/metrics/gc');
      console.log('Reset Stats: POST /api/metrics/reset');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
