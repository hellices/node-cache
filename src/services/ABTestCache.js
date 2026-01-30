const { LRUCache } = require('lru-cache');
const abTestRepository = require('../repository/ABTestRepository');
const bucketingService = require('./BucketingService');

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
          id: v.ab_test_vrt_id,
          key: v.vrt_key,
          value: v.vrt_vl,
          rangeStart: v.vrt_rng_strt,
          rangeEnd: v.vrt_rng_end
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
  // 조회 API (내부용 - 캐시 히트 시 true 반환)
  // ========================================
  async _fetchWithStats(service) {
    // 캐시 히트 여부를 먼저 확인
    const isHit = this.cache.has(service);
    const data = await this.cache.fetch(service);
    
    if (data) {
      if (isHit) {
        this.stats.hits++;
      }
      // misses는 loadFromDB에서 이미 증가됨
    }
    
    return data;
  }
  
  // ========================================
  // 전체 데이터 조회 (효율적 - 단일 캐시 조회)
  // ========================================
  async getData(service) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      return this._loadDirectFromDB(service);
    }
    
    const data = await this._fetchWithStats(service);
    if (!data) return null;
    
    const now = new Date();
    return {
      meeGroupId: data.meeGroupId,
      tests: data.tests.filter(test => 
        test.status === 'ACTIVE' &&
        new Date(test.startDate) <= now &&
        new Date(test.endDate) >= now
      )
    };
  }
  
  // 캐시 비활성화 시 직접 DB 조회
  async _loadDirectFromDB(service) {
    const tests = await abTestRepository.getABTestsByService(service);
    const testIds = tests.map(t => t.ab_test_id);
    const variants = testIds.length > 0 
      ? await abTestRepository.getVariantsByTestIds(testIds)
      : [];
    const meeGroup = await abTestRepository.getMeeGroupId(service);
    
    const now = new Date();
    return {
      meeGroupId: meeGroup[0]?.mee_group_id,
      tests: tests
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
              id: v.ab_test_vrt_id,
              key: v.vrt_key,
              value: v.vrt_vl,
              rangeStart: v.vrt_rng_strt,
              rangeEnd: v.vrt_rng_end
            }))
        }))
    };
  }

  // ========================================
  // 개별 조회 API (기존 호환성)
  // ========================================
  async getMeeGroupId(service) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      const result = await abTestRepository.getMeeGroupId(service);
      return result[0]?.mee_group_id;
    }
    
    const data = await this._fetchWithStats(service);
    return data?.meeGroupId;
  }
  
  async getActiveTests(service) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      const result = await this._loadDirectFromDB(service);
      return result?.tests || [];
    }
    
    const data = await this._fetchWithStats(service);
    if (!data) return [];
    
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
  // 버킷팅: 사용자별 variant 결정
  // 캐시/DB 경로 모두 동일한 버킷팅 로직 수행
  // ========================================
  async getVariantForUser(service, request, testID) {
    if (process.env.ABTEST_CACHE_ENABLED !== 'true') {
      return this._getVariantFromDB(service, request, testID);
    }
    
    const data = await this._fetchWithStats(service);
    if (!data) return null;
    
    const now = new Date();
    const test = data.tests.find(t => 
      t.id === testID &&
      t.status === 'ACTIVE' &&
      new Date(t.startDate) <= now &&
      new Date(t.endDate) >= now
    );
    
    if (!test || !test.variants || test.variants.length === 0) {
      return null;
    }
    
    return bucketingService.processBucketing(testID, test.variants, request);
  }
  
  // DB 직접 조회로 버킷팅
  async _getVariantFromDB(service, request, testID) {
    const data = await this._loadDirectFromDB(service);
    if (!data) return null;
    
    const test = data.tests.find(t => t.id === testID);
    if (!test || !test.variants || test.variants.length === 0) {
      return null;
    }
    
    return bucketingService.processBucketing(testID, test.variants, request);
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
