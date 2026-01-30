require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// 서비스 목록
const SERVICES = [
  'GalaxyStore', 'SamsungHealth', 'SmartThings', 'SamsungPay',
  'Bixby', 'SamsungMembers', 'GalaxyWearable', 'SamsungNotes',
  'GalaxyBuds', 'OneUI', 'SamsungInternet', 'SamsungCalendar',
  'SamsungMessages', 'SamsungGallery', 'SamsungMusic', 'SamsungVideo',
  'SamsungCloud', 'SamsungPass', 'SamsungFlow', 'SamsungDeX'
];

const TEST_TYPES = ['SEGMENT', 'RANDOM', 'TARGETED'];
const TEST_STATUSES = ['ACTIVE', 'INACTIVE', 'COMPLETED'];
const COUNTRIES = ['KR', 'US', 'JP', 'DE', 'FR', 'GB', 'CN', 'IN', 'BR', 'AU', 'CA', 'MX', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL'];
const DEVICES = ['Galaxy S24', 'Galaxy S23', 'Galaxy Z Fold5', 'Galaxy Z Flip5', 'Galaxy A54', 'Galaxy A34', 'Galaxy S24 Ultra', 'Galaxy Tab S9'];
const REGIONS = ['APAC', 'EMEA', 'AMER', 'LATAM'];
const OS_VERSIONS = ['14', '13', '12', '11'];
const LANGUAGES = ['en', 'ko', 'ja', 'de', 'fr', 'es', 'zh', 'pt', 'it', 'ru'];

// 테스트 수 설정 - GC 압력을 높이기 위해 대폭 증가
const TESTS_PER_SERVICE = 50;
const VARIANTS_PER_TEST = 5;

async function seedDatabase() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const connection = await mysql.createConnection({
    host: host,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'abtest',
    password: process.env.MYSQL_PASSWORD || 'testpass',
    database: process.env.MYSQL_DATABASE || 'abtest_db',
    multipleStatements: true,
    ssl: host.includes('azure.com') ? { rejectUnauthorized: false } : undefined
  });

  try {
    console.log('Connected to MySQL');
    
    // 스키마 생성
    console.log('Creating schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    console.log('Schema created');
    
    // 기존 데이터 삭제
    console.log('Clearing existing data...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE ab_test_vrts');
    await connection.query('TRUNCATE TABLE tb_ab_test');
    await connection.query('TRUNCATE TABLE tb_mee_group');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    
    // MEE Groups 생성
    console.log('Creating MEE Groups...');
    for (const service of SERVICES) {
      const meeGroupId = `mee_group_${service.toLowerCase()}`;
      await connection.execute(
        'INSERT INTO tb_mee_group (mee_group_id, svc_cd, mee_group_nm, use_yn) VALUES (?, ?, ?, ?)',
        [meeGroupId, service, `${service} MEE Group`, 'Y']
      );
    }
    console.log(`Created ${SERVICES.length} MEE Groups`);
    
    // AB Tests 생성
    console.log('Creating AB Tests...');
    let totalTests = 0;
    let totalVariants = 0;
    
    for (const service of SERVICES) {
      const meeGroupId = `mee_group_${service.toLowerCase()}`;
      
      for (let i = 0; i < TESTS_PER_SERVICE; i++) {
        const testType = TEST_TYPES[Math.floor(Math.random() * TEST_TYPES.length)];
        const testStatus = i < TESTS_PER_SERVICE * 0.7 ? 'ACTIVE' : TEST_STATUSES[Math.floor(Math.random() * TEST_STATUSES.length)];
        
        const now = new Date();
        const startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - Math.floor(Math.random() * 6));
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + Math.floor(Math.random() * 12) + 1);
        
        // 복잡한 attribute filter 생성
        const attributeFilter = {
          country: COUNTRIES.slice(0, Math.floor(Math.random() * 10) + 5),
          device: DEVICES.slice(0, Math.floor(Math.random() * 5) + 3),
          region: REGIONS.slice(0, Math.floor(Math.random() * 3) + 1),
          osVersion: OS_VERSIONS.slice(0, Math.floor(Math.random() * 3) + 1),
          language: LANGUAGES.slice(0, Math.floor(Math.random() * 5) + 3),
          minAge: Math.floor(Math.random() * 30) + 18,
          maxAge: Math.floor(Math.random() * 30) + 50,
          segment: `segment_${Math.floor(Math.random() * 100)}`,
          features: Array.from({ length: Math.floor(Math.random() * 20) + 10 }, (_, idx) => `feature_${idx}`),
          targetGroups: Array.from({ length: Math.floor(Math.random() * 10) + 5 }, (_, idx) => ({
            groupId: `group_${idx}`,
            priority: idx + 1,
            rules: Array.from({ length: 3 }, (_, ridx) => ({
              field: `field_${ridx}`,
              operator: ['eq', 'ne', 'gt', 'lt', 'in'][ridx % 5],
              value: `value_${ridx}_${Math.random().toString(36).substring(7)}`
            }))
          })),
          customAttributes: Object.fromEntries(
            Array.from({ length: Math.floor(Math.random() * 15) + 10 }, (_, idx) => [
              `attr_${idx}`,
              { type: 'string', value: `custom_value_${idx}_${Math.random().toString(36).substring(7)}` }
            ])
          )
        };
        
        const [result] = await connection.execute(
          `INSERT INTO tb_ab_test 
           (mee_group_id, ab_test_nm, ab_test_type, ab_test_status, ab_test_atrb_fltr, strt_dtm, end_dtm) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            meeGroupId,
            `${service} Test ${i + 1}`,
            testType,
            testStatus,
            JSON.stringify(attributeFilter),
            startDate.toISOString().slice(0, 19).replace('T', ' '),
            endDate.toISOString().slice(0, 19).replace('T', ' ')
          ]
        );
        
        const testId = result.insertId;
        totalTests++;
        
        // Variants 생성 (원본 스키마: range 기반 버킷팅)
        const variantKeys = ['A', 'B', 'C', 'D', 'E'].slice(0, VARIANTS_PER_TEST);
        const rangeSize = 100 / VARIANTS_PER_TEST;
        
        for (let j = 0; j < VARIANTS_PER_TEST; j++) {
          const rangeStart = j * rangeSize;
          const rangeEnd = (j + 1) * rangeSize;
          const variantValue = `variant_${variantKeys[j]}_value_${service.toLowerCase()}`;
          
          await connection.execute(
            'INSERT INTO ab_test_vrts (ab_test_id, vrt_key, vrt_vl, vrt_rng_strt, vrt_rng_end, use_yn) VALUES (?, ?, ?, ?, ?, ?)',
            [testId, variantKeys[j], variantValue, rangeStart, rangeEnd, 'Y']
          );
          totalVariants++;
        }
      }
      
      process.stdout.write(`\rProcessing: ${service} (${totalTests} tests, ${totalVariants} variants)`);
    }
    
    console.log(`\n\n=== Seed Complete ===`);
    console.log(`Services: ${SERVICES.length}`);
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Total Variants: ${totalVariants}`);
    console.log(`Tests per Service: ${TESTS_PER_SERVICE}`);
    console.log(`Variants per Test: ${VARIANTS_PER_TEST}`);
    
    // 통계 조회
    const [stats] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM tb_mee_group) as mee_groups,
        (SELECT COUNT(*) FROM tb_ab_test) as tests,
        (SELECT COUNT(*) FROM tb_ab_test WHERE ab_test_status = 'ACTIVE') as active_tests,
        (SELECT COUNT(*) FROM ab_test_vrts) as variants
    `);
    console.log('\n=== Database Stats ===');
    console.log(stats[0]);
    
  } finally {
    await connection.end();
  }
}

seedDatabase()
  .then(() => {
    console.log('\nSeeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
