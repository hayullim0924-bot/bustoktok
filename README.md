# 버스톡톡 서버 프로젝트

이 프로젝트는 브라우저 화면과 공공데이터포털 TAGO API 사이에 서버를 둡니다. 인증키는 브라우저에 전달되지 않습니다.

## 필요한 것
- Node.js 18 이상을 지원하는 호스팅 서비스
- 공공데이터포털에서 승인된 TAGO 서비스와 일반 인증키(Decoding)

## 환경변수 설정
호스팅 서비스의 Environment Variables(환경변수) 메뉴에 다음 값을 등록합니다.

| 이름 | 값 |
|---|---|
| `DATA_MODE` | `api` |
| `TAGO_SERVICE_KEY` | 공공데이터포털의 일반 인증키(Decoding) |
| `CACHE_TTL_SECONDS` | `30` |
| `API_TIMEOUT_MS` | `12000` |

`.env.example`은 예시 파일입니다. 실제 배포에서는 호스팅 사이트의 환경변수 메뉴에 입력하는 것을 권장합니다. `.env` 파일과 인증키를 GitHub에 올리지 마세요.

## 로컬 실행
1. Node.js 18 이상 설치
2. 프로젝트 폴더에서 `npm install`
3. `.env.example`을 복사해 `.env`로 이름 변경
4. `.env`의 `TAGO_SERVICE_KEY`에 일반 인증키(Decoding) 입력
5. `npm start`
6. 브라우저에서 `http://localhost:3000` 접속

## API
- `GET /api/health` 서버/키 설정 상태
- `GET /api/cities` TAGO 제공 도시 코드
- `GET /api/search?type=route&q=13` 노선 검색
- `GET /api/search?type=station&q=수원역` 정류장 검색
- `GET /api/route/:cityCode/:routeId/stops` 노선 경유 정류장
- `GET /api/station/:cityCode/:nodeId/arrivals` 정류장 도착정보
- `GET /api/route/:cityCode/:routeId/locations` 노선별 버스 위치
- `GET /api/nearby?lat=37.26&lng=127.00&radius=700` 주변 정류장

## 참고 및 제한
- TAGO API의 실제 제공 범위, 승인된 상세 서비스, 지역별 데이터 품질에 따라 결과가 달라집니다. '전국' 검색은 도시 코드 목록을 기준으로 여러 지역을 조회하지만, 각 지역 API가 동일하게 제공된다는 뜻은 아닙니다.
- 도착정보/차량 위치는 정류장·노선 검색 결과의 지역 코드와 ID를 이용해 조회해야 합니다.
- 현재 화면은 검색 결과와 정류장 도착정보 중심의 기본 버전입니다. 실제 API 응답 필드명은 제공기관 응답에 따라 달라질 수 있으므로 운영 전 확인이 필요합니다.
- 인증키를 HTML, 공개 저장소, 채팅에 붙여 넣지 마세요.
