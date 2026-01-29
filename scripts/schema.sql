-- ============================================
-- AB Test 캐시 벤치마크를 위한 스키마 (MySQL)
-- ============================================

-- MEE Group 테이블
CREATE TABLE IF NOT EXISTS tb_mee_group (
  mee_group_id VARCHAR(50) PRIMARY KEY,
  svc_cd VARCHAR(50) NOT NULL,
  mee_group_nm VARCHAR(100),
  use_yn CHAR(1) DEFAULT 'Y',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_svc_cd (svc_cd),
  INDEX idx_use_yn (use_yn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AB Test 테이블
CREATE TABLE IF NOT EXISTS tb_ab_test (
  ab_test_id INT AUTO_INCREMENT PRIMARY KEY,
  mee_group_id VARCHAR(50) NOT NULL,
  ab_test_nm VARCHAR(100) NOT NULL,
  ab_test_type VARCHAR(20) NOT NULL,
  ab_test_status VARCHAR(20) NOT NULL,
  ab_test_atrb_fltr LONGTEXT,
  strt_dtm DATETIME NOT NULL,
  end_dtm DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mee_group_id (mee_group_id),
  INDEX idx_status (ab_test_status),
  INDEX idx_dates (strt_dtm, end_dtm),
  FOREIGN KEY (mee_group_id) REFERENCES tb_mee_group(mee_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AB Test Variant 테이블
CREATE TABLE IF NOT EXISTS tb_ab_test_vrnt (
  vrnt_id INT AUTO_INCREMENT PRIMARY KEY,
  ab_test_id INT NOT NULL,
  vrnt_key VARCHAR(50) NOT NULL,
  vrnt_ratio INT NOT NULL,
  vrnt_payload LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ab_test_id (ab_test_id),
  FOREIGN KEY (ab_test_id) REFERENCES tb_ab_test(ab_test_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
