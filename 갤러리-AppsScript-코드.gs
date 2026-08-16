/**
 * 바닐라 헤어 · 갤러리 업로드 서버
 * ────────────────────────────────────────────────────────────
 * 구글 앱스 스크립트로 도는 아주 작은 서버입니다. 하는 일은 셋:
 *
 *   1. 원본 사진   →  구글 드라이브 (설정해 두면 자동 백업, 안 해도 됩니다)
 *   2. 웹용 축소본 →  홈페이지 저장소의 gallery 브랜치
 *   3. 사진 목록   →  photos.json 갱신 (홈페이지 갤러리가 이걸 읽습니다)
 *
 * 사진을 별도 브랜치에 넣기 때문에 홈페이지가 다시 빌드되지 않습니다.
 * 그래서 올리면 곧바로 갤러리에 나타납니다.
 *
 * 설치 방법은 같은 폴더의 갤러리-설정방법.md 를 보세요.
 * 비밀번호와 토큰은 이 파일에 적지 말고 「스크립트 속성」에 넣습니다.
 *
 * 이 스크립트는 바닐라 헤어 전용입니다.
 * 다른 사업장(YM토탈이벤트, 큰길이벤트)과 저장소도 스크립트도 완전히 분리되어 있습니다.
 */

/* ══ 스크립트 속성에서 설정을 읽어온다 ══
   UPLOAD_PW     업로드 비밀번호 (사장님만 아는 값)          [필수]
   GH_TOKEN      GitHub 토큰 (banilla-hair Contents 쓰기)    [필수]
   GH_REPO       brizymedia/banilla-hair                     [필수]
   GH_BRANCH     gallery                                     [없으면 gallery]
   DRIVE_FOLDER  원본을 모아둘 구글 드라이브 폴더 ID          [선택]        */

function 설정(키, 기본값) {
  var v = PropertiesService.getScriptProperties().getProperty(키);
  if (v === null || v === '') {
    if (기본값 !== undefined) return 기본값;
    throw new Error('스크립트 속성에 ' + 키 + ' 가 없습니다. 설정방법 문서의 2단계를 확인해 주세요.');
  }
  return v;
}

var 저장경로 = 'photos';
var 목록파일 = 저장경로 + '/photos.json';

function 답장(객체) {
  return ContentService
    .createTextOutput(JSON.stringify(객체))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return 답장({ ok: true, service: '바닐라 헤어 갤러리 업로드' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return 답장({ ok: false, error: '보낸 내용이 비어 있습니다' });
    }
    var 요청 = JSON.parse(e.postData.contents);

    // 연결 확인은 비밀번호 없이도 답한다 (준비 상태만 알려주고 비밀은 알려주지 않는다)
    if (요청.action === 'ping') {
      var 준비 = {};
      ['UPLOAD_PW', 'GH_TOKEN', 'GH_REPO'].forEach(function (k) {
        준비[k] = !!PropertiesService.getScriptProperties().getProperty(k);
      });
      준비.DRIVE_FOLDER = !!PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER');
      return 답장({
        ok: true,
        ready: 준비.UPLOAD_PW && 준비.GH_TOKEN && 준비.GH_REPO,
        설정: 준비
      });
    }

    if (String(요청.pw || '') !== String(설정('UPLOAD_PW'))) {
      return 답장({ ok: false, error: '비밀번호가 다릅니다' });
    }

    switch (요청.action) {
      case 'photo':  return 사진올리기(요청);
      case 'finish': return 목록갱신(요청);
      case 'delete': return 사진지우기(요청);
      default:       return 답장({ ok: false, error: '알 수 없는 요청: ' + 요청.action });
    }
  } catch (err) {
    return 답장({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ══════════════════════════════════════════════════════════════
   사진 한 장 올리기
   ══════════════════════════════════════════════════════════════ */

function 사진올리기(요청) {
  if (!요청.web) return 답장({ ok: false, error: '사진 데이터가 없습니다' });

  var 확장자 = (요청.origName && 요청.origName.toLowerCase().indexOf('.png') > -1) ? 'png' : 'jpg';
  var 파일명 = 'g' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000) + '.' + 확장자;
  var 경로 = 저장경로 + '/' + 파일명;

  var 결과 = 깃허브에올리기(경로, 요청.web, '갤러리 사진 추가: ' + 파일명);
  if (!결과.ok) return 답장(결과);

  // 원본 백업은 설정해 둔 경우에만 (실패해도 업로드 자체는 성공으로 본다)
  var 원본경고 = '';
  if (요청.orig) {
    try {
      var 폴더ID = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER');
      if (폴더ID) {
        var blob = Utilities.newBlob(
          Utilities.base64Decode(요청.orig),
          확장자 === 'png' ? 'image/png' : 'image/jpeg',
          (요청.origName || 파일명)
        );
        DriveApp.getFolderById(폴더ID).createFile(blob);
      }
    } catch (err) {
      원본경고 = '원본 백업 실패: ' + (err.message || err);
    }
  }

  return 답장({ ok: true, file: 파일명, path: 경로, 원본경고: 원본경고 });
}

/* ══════════════════════════════════════════════════════════════
   목록 읽기 / 쓰기
   ══════════════════════════════════════════════════════════════ */

function 목록읽기() {
  var 응 = 깃허브(목록파일 + '?ref=' + 설정('GH_BRANCH', 'gallery'), 'get');
  if (응.getResponseCode() !== 200) return { photos: [], sha: null };
  try {
    var 내용 = JSON.parse(응.getContentText());
    var 글 = Utilities.newBlob(Utilities.base64Decode(내용.content)).getDataAsString();
    var 값 = JSON.parse(글);
    return { photos: Array.isArray(값) ? 값 : [], sha: 내용.sha };
  } catch (err) {
    return { photos: [], sha: null };
  }
}

function 목록쓰기(사진들, 메모) {
  var 본문 = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(사진들, null, 1)).getBytes()
  );
  return 깃허브에올리기(목록파일, 본문, 메모);
}

/** 올린 사진들을 목록 맨 앞에 넣는다 (최신이 먼저 보이도록). */
function 목록갱신(요청) {
  var 새것 = 요청.photos || [];
  if (!새것.length) return 답장({ ok: true, added: 0 });

  var 지금 = 목록읽기();
  var 이미있음 = {};
  지금.photos.forEach(function (p) { if (p && p.file) 이미있음[p.file] = true; });

  var 추가 = 새것.filter(function (p) { return p && p.file && !이미있음[p.file]; });
  var 합친것 = 추가.concat(지금.photos);

  var 결과 = 목록쓰기(합친것, '갤러리 목록 갱신 (+' + 추가.length + '장)');
  if (!결과.ok) return 답장(결과);

  return 답장({ ok: true, added: 추가.length, total: 합친것.length });
}

/* ══════════════════════════════════════════════════════════════
   사진 지우기
   ══════════════════════════════════════════════════════════════ */

function 사진지우기(요청) {
  var 지울것 = 요청.files || [];
  if (!지울것.length) return 답장({ ok: false, error: '지울 사진이 없습니다' });

  var 브랜치 = 설정('GH_BRANCH', 'gallery');
  var 지움 = 0;

  for (var i = 0; i < 지울것.length; i++) {
    var 파일 = 지울것[i];
    var 있나 = 깃허브(저장경로 + '/' + 파일 + '?ref=' + 브랜치, 'get');
    if (있나.getResponseCode() !== 200) continue;
    var sha;
    try { sha = JSON.parse(있나.getContentText()).sha; } catch (err) { continue; }

    var 응 = 깃허브(저장경로 + '/' + 파일, 'delete', {
      message: '갤러리 사진 삭제: ' + 파일,
      sha: sha,
      branch: 브랜치
    });
    if (응.getResponseCode() === 200) 지움++;
  }

  var 지금 = 목록읽기();
  var 남은것 = 지금.photos.filter(function (p) {
    return !p || !p.file || 지울것.indexOf(p.file) === -1;
  });
  목록쓰기(남은것, '갤러리 목록 갱신 (-' + 지움 + '장)');

  return 답장({ ok: true, deleted: 지움, total: 남은것.length });
}

/* ══════════════════════════════════════════════════════════════
   GitHub 통신
   ══════════════════════════════════════════════════════════════ */

function 깃허브(경로, 방법, 본문) {
  return UrlFetchApp.fetch(
    'https://api.github.com/repos/' + 설정('GH_REPO') + '/contents/' + 경로,
    {
      method: 방법,
      headers: {
        Authorization: 'Bearer ' + 설정('GH_TOKEN'),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'banilla-hair-gallery'
      },
      contentType: 'application/json',
      payload: 본문 ? JSON.stringify(본문) : undefined,
      muteHttpExceptions: true
    }
  );
}

function 깃허브에올리기(경로, base64, 메모) {
  var 브랜치 = 설정('GH_BRANCH', 'gallery');
  var 본문 = { message: 메모, content: base64, branch: 브랜치 };

  // 이미 있는 파일이면 sha 를 같이 보내야 덮어쓸 수 있다
  var 기존 = 깃허브(경로 + '?ref=' + 브랜치, 'get');
  if (기존.getResponseCode() === 200) {
    try { 본문.sha = JSON.parse(기존.getContentText()).sha; } catch (err) { /* 무시 */ }
  }

  var 응 = 깃허브(경로, 'put', 본문);
  var 코드 = 응.getResponseCode();
  if (코드 === 200 || 코드 === 201) return { ok: true };

  var 사유 = 응.getContentText();
  try { 사유 = JSON.parse(사유).message || 사유; } catch (err) { /* 그대로 */ }
  return { ok: false, error: '깃허브 저장 실패 (' + 코드 + ') ' + 사유 };
}
