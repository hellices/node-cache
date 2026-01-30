const db = require('../config/database');

class ABTestRepository {
  
  async getAllServices() {
    const rows = await db.query(
      "SELECT DISTINCT svc_cd FROM tb_mee_group WHERE use_yn = 'Y'"
    );
    return rows.map(r => r.svc_cd);
  }
  
  async getMeeGroupId(service) {
    return db.query(
      "SELECT mee_group_id FROM tb_mee_group WHERE svc_cd = ? AND use_yn = 'Y'",
      [service]
    );
  }
  
  async getABTestsByService(service) {
    return db.query(`
      SELECT 
        t.ab_test_id,
        t.ab_test_nm,
        t.ab_test_type,
        t.ab_test_status,
        t.ab_test_atrb_fltr,
        t.strt_dtm,
        t.end_dtm
      FROM tb_ab_test t
      INNER JOIN tb_mee_group g ON t.mee_group_id = g.mee_group_id
      WHERE g.svc_cd = ? AND g.use_yn = 'Y'
    `, [service]);
  }
  
  async getVariantsByTestIds(testIds) {
    if (!testIds || testIds.length === 0) {
      return [];
    }
    
    const placeholders = testIds.map(() => '?').join(',');
    return db.query(`
      SELECT 
        ab_test_vrt_id,
        ab_test_id,
        vrt_key,
        vrt_vl,
        vrt_rng_strt,
        vrt_rng_end
      FROM ab_test_vrts
      WHERE ab_test_id IN (${placeholders}) AND use_yn = 'Y'
    `, testIds);
  }
}

module.exports = new ABTestRepository();
