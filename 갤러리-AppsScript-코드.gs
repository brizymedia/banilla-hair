/**
 * 바닐라 헤어 · 갤러리 업로드 서버 (구글 앱스스크립트)
 *
 * 하는 일: 홈페이지에서 보낸 사진을 받아 GitHub 저장소에 넣고,
 *          갤러리 목록(gallery/photos.json)을 갱신한다.
 *
 * 이 스크립트가 GitHub 토큰을 대신 보관하므로,
 * 사장님 휴대폰이나 PC에는 토큰이 저장되지 않는다. 비밀번호만 있으면 된다.
 *
 * 설정값은 코드에 적지 말고 [프로젝트 설정 > 스크립트 속성] 에 넣는다.
 *   UPLOAD_PW : 업로드 비밀번호 (사장님이 정한 값)
 *   GH_TOKEN  : GitHub 토큰 (banilla-hair 저장소 Contents 읽기/쓰기)
 *   GH_OWNER  : brizymedia
 *   GH_REPO   : banilla-hair
 *   GH_BRANCH : main
 */

var DIR = 'gallery';
var MANIFEST = 'gallery/photos.json';

function 설정(이름, 기본값) {
  var v = PropertiesService.getScriptProperties().getProperty(이름);
  return (v === null || v === '') ? 기본값 : v;
}

function 답장(객체) {
  return ContentService
    .createTextOutput(JSON.stringify(객체))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 브라우저에서 서버가 살아있는지 확인할 때 쓴다. */
function doGet() {
  return 답장({ ok: true, service: '바닐라 헤어 갤러리 업로드', ready: !!설정('GH_TOKEN', '') });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return 답장({ ok: false, error: '보낸 내용이 비어 있습니다' });
    }
    var 요청 = JSON.parse(e.postData.contents);

    // 연결 확인은 비밀번호 없이도 답한다 (준비 상태만 알려주고 비밀은 알려주지 않는다)
    if (요청.action === 'ping') {
      return 답장({
        ok: true,
        ready: !!설정('GH_TOKEN', '') && !!설정('UPLOAD_PW', '')
      });
    }

    var 비번 = 설정('UPLOAD_PW', '');
    if (!비번) return 답장({ ok: false, error: '서버에 비밀번호가 설정되지 않았습니다 (UPLOAD_PW)' });
    if (String(요청.pw || '') !== String(비번)) {
      return 답장({ ok: false, error: '비밀번호가 다릅니다' });
    }

    if (!설정('GH_TOKEN', '')) {
      return 답장({ ok: false, error: '서버에 GitHub 토큰이 설정되지 않았습니다 (GH_TOKEN)' });
    }

    switch (요청.action) {
      case 'photo':  return 사진올리기(요청);
      case 'finish': return 목록갱신(요청);
      case 'list':   return 답장({ ok: true, photos: 목록읽기().photos });
      case 'delete': return 사진지우기(요청);
      default:       return 답장({ ok: false, error: '알 수 없는 요청: ' + 요청.action });
    }
  } catch (err) {
    return 답장({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------------- GitHub 통신 ---------------- */

function 깃허브(경로, 옵션) {
  var 주소 = 'https://api.github.com/repos/'
    + 설정('GH_OWNER', 'brizymedia') + '/'
    + 설정('GH_REPO', 'banilla-hair') + '/' + 경로;

  var 설정값 = {
    method: (옵션 && 옵션.method) || 'get',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + 설정('GH_TOKEN', ''),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'banilla-hair-gallery'
    }
  };
  if (옵션 && 옵션.payload) 설정값.payload = JSON.stringify(옵션.payload);

  var 응답 = UrlFetchApp.fetch(주소, 설정값);
  var 코드 = 응답.getResponseCode();
  var 글 = 응답.getContentText();

  if (코드 === 404) return { 없음: true };
  if (코드 >= 300) {
    var 사유 = 글;
    try { 사유 = JSON.parse(글).message || 글; } catch (e2) {}
    throw new Error('GitHub 오류 ' + 코드 + ': ' + 사유);
  }
  return JSON.parse(글);
}

/* ---------------- 사진 한 장 올리기 ---------------- */

function 사진올리기(요청) {
  if (!요청.web) return 답장({ ok: false, error: '사진 데이터가 없습니다' });

  var 확장자 = (요청.origName && 요청.origName.toLowerCase().indexOf('.png') > -1) ? 'png' : 'jpg';
  var 이름 = 'g' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000) + '.' + 확장자;
  var 경로 = DIR + '/' + 이름;

  깃허브('contents/' + 경로, {
    method: 'put',
    payload: {
      message: '갤러리 사진 추가: ' + 이름,
      content: 요청.web,
      branch: 설정('GH_BRANCH', 'main')
    }
  });

  return 답장({ ok: true, file: 이름, path: 경로 });
}

/* ---------------- 목록 읽기 / 쓰기 ---------------- */

function 목록읽기() {
  var 결과 = 깃허브('contents/' + MANIFEST + '?ref=' + 설정('GH_BRANCH', 'main'));
  if (결과.없음) return { photos: [], sha: null };
  var 글 = Utilities.newBlob(Utilities.base64Decode(결과.content)).getDataAsString();
  var 목록;
  try { 목록 = JSON.parse(글); } catch (e) { 목록 = []; }
  if (!Array.isArray(목록)) 목록 = [];
  return { photos: 목록, sha: 결과.sha };
}

function 목록쓰기(사진들, sha, 메시지) {
  var 본문 = {
    message: 메시지,
    content: Utilities.base64Encode(
      Utilities.newBlob(JSON.stringify(사진들, null, 1)).getBytes()
    ),
    branch: 설정('GH_BRANCH', 'main')
  };
  if (sha) 본문.sha = sha;
  깃허브('contents/' + MANIFEST, { method: 'put', payload: 본문 });
}

/** 올린 사진들을 목록 맨 앞에 넣는다 (최신이 먼저 보이도록). */
function 목록갱신(요청) {
  var 새것 = 요청.photos || [];
  if (!새것.length) return 답장({ ok: true, added: 0 });

  var 현재 = 목록읽기();
  var 합친것 = 새것.concat(현재.photos);

  목록쓰기(합친것, 현재.sha, '갤러리 목록 갱신 (+' + 새것.length + ')');
  return 답장({ ok: true, added: 새것.length, total: 합친것.length });
}

/* ---------------- 사진 지우기 ---------------- */

function 사진지우기(요청) {
  var 지울것 = 요청.files || [];
  if (!지울것.length) return 답장({ ok: false, error: '지울 사진이 없습니다' });

  var 지움 = 0;
  for (var i = 0; i < 지울것.length; i++) {
    var 파일 = 지울것[i];
    var 정보 = 깃허브('contents/' + DIR + '/' + 파일 + '?ref=' + 설정('GH_BRANCH', 'main'));
    if (정보.없음) continue;
    깃허브('contents/' + DIR + '/' + 파일, {
      method: 'delete',
      payload: {
        message: '갤러리 사진 삭제: ' + 파일,
        sha: 정보.sha,
        branch: 설정('GH_BRANCH', 'main')
      }
    });
    지움++;
  }

  var 현재 = 목록읽기();
  var 남은것 = 현재.photos.filter(function (p) {
    return 지울것.indexOf(p.file) === -1;
  });
  목록쓰기(남은것, 현재.sha, '갤러리 목록 갱신 (-' + 지움 + ')');

  return 답장({ ok: true, deleted: 지움, total: 남은것.length });
}
