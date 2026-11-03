# 명령어 핸드북 (웹앱)

솔루션 엔지니어용 명령어 핸드북 웹앱입니다. RHEL·Rocky / Ubuntu·Debian / Windows 명령어 393개의 사용법을 휴대폰과 PC에서 바로 찾아볼 수 있습니다.

**접속 주소: https://jmineeekim.github.io/cmd-handbook/**

## 휴대폰에 설치하기

- **Android (Chrome)**: 주소를 연 뒤 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"
- **iPhone (Safari)**: 주소를 연 뒤 공유 버튼 → "홈 화면에 추가"

설치하면 주소창 없이 앱처럼 열리고, 한 번 연 뒤에는 인터넷 없이도 동작합니다.

## 기능

- 카테고리 15개 → 기능별 명령어 목록 → 명령어 상세
- OS 필터 (전체 / RHEL·Rocky / Ubuntu·Debian / Windows), 설정에서 기본값 지정
- 검색: 명령어 이름, 한글 기능명, 키워드, 옵션, 예시까지
- 상세: 실무 예시(복사 버튼, 바꿔 쓸 값 강조), 주요 옵션, 주의사항, OS별 차이, 설치 정보, 같은 기능의 다른 OS 명령어
- 즐겨찾기, 최근 본 명령어, 다크·라이트 테마, 명령어 글자 크기

## 데이터

명령어 데이터는 [cmd-handbook-data](https://github.com/jmineeekim/cmd-handbook-data) 저장소에서 관리합니다.

1. 앱에는 `data/handbook.json` 이 내장되어 처음 실행할 때 바로 동작합니다.
2. 앱을 열 때 데이터 저장소의 `version.json` 을 확인하고, 새 버전이면 `dist/handbook.json` 을 받아 sha256 을 검증한 뒤 기기에 저장합니다.
3. 데이터만 바꿀 때는 데이터 저장소만 수정하면 됩니다. 이 저장소의 `data/handbook.json` 은 첫 실행용이라 가끔 갱신하면 충분합니다.

## 파일

| 파일 | 설명 |
|---|---|
| `index.html` | 앱 화면 틀 |
| `styles.css` | 디자인 (다크·라이트) |
| `app.js` | 화면, 검색, 데이터 업데이트 |
| `sw.js` | 오프라인 동작을 위한 서비스 워커 |
| `manifest.webmanifest`, `icons/` | 홈 화면 설치 정보, 아이콘 |
| `data/handbook.json` | 내장 데이터 |

앱 코드를 고친 뒤에는 `sw.js` 의 `VERSION` 값을 올려야 휴대폰에 새 버전이 확실히 반영됩니다.
