const { LRUCache } = require('lru-cache');
const abTestRepository = require('../repository/ABTestRepository');

class ABTestCache {
  constructor() {
    this.cache = new LRUCache({
      max: 100,
      // 캐시 미스 시 자동 호출
      fetchMethod: async (service) => {
        console.log(`[Cache] Fetching from DB for service: ${service}`);
        return await this.loadFromDB(service);
      }
    });
    
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0
    };
  }

  // ========================================
  // DB 로드 + 변환 (Level 2)
  // 이 로직이 fetchMethod 한 곳에만 존재
  // ========================================
  async loadFromDB(service) {
    const testRows = await abTestRepository.getABTestsByService(service);
    const testIds = testRows.map(t => t.ab_test_id);
    const variantRows = testIds.length > 0 
      ? await abTestRepository.getVariantsByTestIds(testIds)
      : [];
    const meeGroup = await abTestRepository.getMeeGroupId(service);
    
    // 변환 + 조합
    const tests = testRows.map(test => ({
      id: test.ab_test_id,
      name: test.ab_test_nm,
      type: test.ab_test_type,
      status: test.ab_test_status,
      attributeFilter: JSON.parse(test.ab_test_atrb_fltr || '{}'),
      startDate: test.strt_dtm?.toISOString ? test.strt_dtm.toISOString() : test.strt_dtm,
      endDate: test.end_dtm?.toISOString ? test.end_dtm.toISOString() : test.end_dtm,
      variants: variantRows
        .filter(v => v.ab_test_id === test.ab_test_id)
        .map(v => ({
          id: v.vrnt_id,
          key: v.vrnt_key,
          ratio: v.vrnt_ratio,
          payload: JSON.parse(v.vrnt_payload || '{}')
        }))
    }));
    
    this.stats.misses++;
    
    return {
      meeGroupId: meeGroup[0]?.mee_group_id,
      tests: tests,
      loadedAt: new Date().toISOString()
    };
  }

  // ========================================
  // 초기화 (서버 시작 시)
  // ========================================
  async initialize() {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      console.log('[Cache] ABTest Cache disabled');
      return;
    }
    
    // 프리로드
    const services = await abTestRepository.getAllServices();
    console.log(`[Cache] Preloading ${services.length} services...`);
    
    for (const service of services) {
      await this.cache.fetch(service);
    }
    console.log(`[Cache] ABTest Cache loaded: ${services.length} services`);
  }

  // ========================================
  // 캐시 무효화 (직접 호출)
  // ========================================
  invalidate(service) {
    console.log(`[Cache] Invalidating cache for service: ${service}`);
    this.cache.delete(service);
    this.stats.invalidations++;
  }
  
  invalidateAll() {
    console.log('[Cache] Invalidating all cache');
    this.cache.clear();
    this.stats.invalidations++;
  }

  // ========================================
  // 조회 API
  // ========================================
  async getMeeGroupId(service) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      const result = await abTestRepository.getMeeGroupId(service);
      return result[0]?.mee_group_id;
    }
    
    const data = await this.cache.fetch(service);
    if (data) this.stats.hits++;
    return data?.meeGroupId;
  }
  
  async getActiveTests(service) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      // 캐시 비활성화 시 직접 조회
      const tests = await abTestRepository.getABTestsByService(service);
      const testIds = tests.map(t => t.ab_test_id);
      const variants = testIds.length > 0 
        ? await abTestRepository.getVariantsByTestIds(testIds)
        : [];
      
      const now = new Date();
      return tests
        .filter(t => t.ab_test_status === 'ACTIVE' && 
                    new Date(t.strt_dtm) <= now && 
                    new Date(t.end_dtm) >= now)
        .map(test => ({
          id: test.ab_test_id,
          name: test.ab_test_nm,
          type: test.ab_test_type,
          status: test.ab_test_status,
          attributeFilter: JSON.parse(test.ab_test_atrb_fltr || '{}'),
          startDate: test.strt_dtm?.toISOString ? test.strt_dtm.toISOString() : test.strt_dtm,
          endDate: test.end_dtm?.toISOString ? test.end_dtm.toISOString() : test.end_dtm,
          variants: variants
            .filter(v => v.ab_test_id === test.ab_test_id)
            .map(v => ({
              id: v.vrnt_id,
              key: v.vrnt_key,
              ratio: v.vrnt_ratio,
              payload: JSON.parse(v.vrnt_payload || '{}')
            }))
        }));
    }
    
    const data = await this.cache.fetch(service);
    if (!data) return [];
    
    this.stats.hits++;
    
    const now = new Date();
    return data.tests.filter(test => 
      test.status === 'ACTIVE' &&
      new Date(test.startDate) <= now &&
      new Date(test.endDate) >= now
    );
  }
  
  // ========================================
  // 캐시 강제 리로드
  // ========================================
  async reload() {
    this.cache.clear();
    const services = await abTestRepository.getAllServices();
    for (const service of services) {
      await this.cache.fetch(service);
    }
  }
  
  // ========================================
  // 통계
  // ========================================
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheEnabled: process.env.ABTEST_CACHE_ENABLED === 'true'
    };
  }
}

module.exports = new ABTestCache();
