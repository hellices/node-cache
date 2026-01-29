# AB Test In-Memory Cache Benchmark

이 프로젝트는 [in-memory-cache-architecture.md](./in-memory-cache-architecture.md)의 아키텍처를 테스트하기 위한 벤치마크 환경입니다.

## 구성 요소

- **Node.js API 서버**: DB 직접 조회 vs 인메모리 캐시 조회 비교
- **MySQL**: AB Test 데이터 저장 (Docker로 실행)
- **lru-cache**: 인메모리 캐시

## 프로젝트 구조

```
├── src/
│   ├── app.js                 # Express 서버
│   ├── config/
│   │   └── database.js        # MySQL 연결
│   ├── repository/
│   │   └── ABTestRepository.js  # DB 쿼리
│   └── services/
│       └── ABTestCache.js     # lru-cache 기반 캐시
├── scripts/
│   ├── schema.sql             # DB 스키마
│   ├── seed-database.js       # 테스트 데이터 생성
│   ├── benchmark.js           # 성능 비교 벤치마크
│   ├── benchmark-gc.js        # GC 분석 벤치마크
│   └── load-test.js           # 부하 테스트
└── docker-compose.yml         # MySQL Docker 설정
```

## 빠른 시작

```bash
# 1. MySQL 실행 (Docker)
docker-compose up -d

# 2. 환경 변수 설정
cp .env.example .env

# 3. 의존성 설치
npm install

# 4. 데이터베이스 시드 (대용량 데이터 생성)
npm run seed

# 5. 서버 실행
npm start

# 6. 벤치마크 (별도 터미널)
npm run benchmark
```

### GC 스트레스 테스트 (권장)

GC 압력 차이를 명확하게 확인하려면:

```bash
# 1. 힙 메모리 제한 (128MB)으로 서버 실행
npm run start:gc-stress

# 2. 별도 터미널에서 GC 벤치마크 실행
npm run benchmark:gc

# 또는 더 많은 반복 (5000회)
npm run benchmark:gc-stress
```

**데이터 크기:**
- 20개 서비스 x 50개 테스트 x 5개 variants = 5,000개 variant
- 각 테스트당 ~20KB 이상의 JSON payload (다국어 번역, 복잡한 메타데이터)
- 서비스당 캐시 데이터 ~1MB
- 전체 캐시 크기: ~20MB

## API 엔드포인트

### 테스트 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/abtest/db/:service` | DB에서 직접 조회 (매번 쿼리 실행) |
| GET | `/api/v1/abtest/cache/:service` | 인메모리 캐시에서 조회 |

### 관리 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/admin/cache/invalidate` | 캐시 무효화 |
| GET | `/api/admin/cache/stats` | 캐시 통계 |
| POST | `/api/admin/cache/reload` | 캐시 강제 리로드 |
| GET | `/api/metrics/memory` | 메모리 사용량 |
| GET | `/health` | 헬스 체크 |

### 사용 예시

```bash
# DB 직접 조회
curl http://localhost:3000/api/v1/abtest/db/GalaxyStore

# 캐시에서 조회
curl http://localhost:3000/api/v1/abtest/cache/GalaxyStore

# 특정 서비스 캐시 무효화
curl -X POST http://localhost:3000/api/admin/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"service": "GalaxyStore"}'

# 전체 캐시 무효화
curl -X POST http://localhost:3000/api/admin/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"type": "ALL"}'

# 캐시 통계
curl http://localhost:3000/api/admin/cache/stats

# 메모리 사용량
curl http://localhost:3000/api/metrics/memory
```

## 벤치마크 실행

### 기본 벤치마크

```bash
npm run benchmark
```

### GC 분석 벤치마크 (핵심)

```bash
# 터미널 1: GC 스트레스 모드로 서버 실행
npm run start:gc-stress

# 터미널 2: GC 벤치마크 실행
npm run benchmark:gc
```

결과 예시:
```
--- GC Analysis (Total) ---
Metric               | DB Direct        | Cache            | Improvement
----------------------------------------------------------------------
GC Count (Total)     |              156 |               23 | 85.3% fewer
Total GC Time (ms)   |           234.56 |            12.34 | 94.7% less

--- Per-Request Overhead (Estimated) ---
Metric               | DB Direct        | Cache            | Reduction
----------------------------------------------------------------------
Memory Alloc/Req     |         12.45 KB |          0.23 KB | 98.2%
```

### 부하 테스트

```bash
npm run test:load
```

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `MYSQL_HOST` | MySQL 호스트 | localhost |
| `MYSQL_PORT` | MySQL 포트 | 3306 |
| `MYSQL_USER` | MySQL 사용자 | abtest |
| `MYSQL_PASSWORD` | MySQL 비밀번호 | testpass |
| `MYSQL_DATABASE` | MySQL 데이터베이스 | abtest_db |
| `ABTEST_CACHE_ENABLED` | 캐시 활성화 | true |
| `PORT` | 서버 포트 | 3000 |

## npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm start` | 서버 실행 |
| `npm run start:gc-stress` | GC 스트레스 테스트 모드 (128MB 힙 제한) |
| `npm run seed` | 테스트 데이터 생성 |
| `npm run benchmark` | 성능 벤치마크 |
| `npm run benchmark:gc` | GC 분석 벤치마크 |
| `npm run benchmark:gc-stress` | GC 스트레스 벤치마크 (5000회) |
| `npm run test:load` | 부하 테스트 |

## 기대 결과

### GC 지표 (3000회 요청 기준, 128MB 힙 제한)

| 지표 | DB 직접 | 캐시 | 개선율 |
|------|---------|------|--------|
| GC 발생 횟수 | 150~200회 | 20~30회 | ~85% fewer |
| 총 GC 시간 | 200~300ms | 10~30ms | ~90% less |
| 메모리 할당/요청 | 10~15 KB | 0.1~0.5 KB | ~97% |
