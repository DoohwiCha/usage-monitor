# Usage Monitor

다중 계정 사용량 모니터 전용 프로젝트입니다.

## 실행

```bash
cd /home/dominic/usage-monitor
npm install
npm run dev -- -p 3001
```

## 화면

- 로그인: `http://localhost:3001/monitor/login`
- 대시보드: `http://localhost:3001/monitor`
- 계정관리: `http://localhost:3001/monitor/accounts`

## 기본 로그인

- ID: `admin`
- PW: `admin1234`

## 참고

- 계정 데이터 파일: `data/usage-monitor.json`
- 웹 계정 자동 로그인(anthropic_web) 사용 시 Playwright/Chromium 필요
