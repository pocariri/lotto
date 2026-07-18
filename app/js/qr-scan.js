// qr-scan.js — QR 읽기 담당. 카메라(또는 사진 파일)에서 QR "문자열 하나"를 얻어 돌려줄 뿐,
// 해석(lottery.js parseTicketQr)이나 화면 상태(check.js)는 모른다. (스펙 6절 경계)
// 사용: Lotto.qrscan.open(function (text) { ... }) — 인식 성공 시 오버레이를 닫고 text 전달.

window.Lotto = window.Lotto || {};

Lotto.qrscan = (function () {
  var el = {};
  var stream = null;    // 카메라 MediaStream — 닫을 때 반드시 stop (불빛 꺼짐)
  var timer = null;     // 카메라 프레임 스캔 주기
  var onResult = null;
  var lastFocus = null; // 오버레이 닫으면 원래 포커스로 복귀 (접근성)
  var canvas = null, ctx = null;
  var camGen = 0; // 권한 대기 중 닫기→재열기 시 옛 스트림이 새 스트림을 덮어쓰지 않게 막는 세대 번호

  function init() {
    el.overlay = document.getElementById('qr-overlay');
    el.video = document.getElementById('qr-video');
    el.hint = document.getElementById('qr-hint');
    el.fileBtn = document.getElementById('qr-file-btn');
    el.fileInput = document.getElementById('qr-file-input');
    el.closeBtn = document.getElementById('qr-close-btn');
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    el.closeBtn.addEventListener('click', close);
    el.fileBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', onFile);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !el.overlay.hidden) close();
    });
  }

  function open(cb) {
    if (!el.overlay) init();
    onResult = cb;
    lastFocus = document.activeElement;
    el.fileInput.value = '';
    el.hint.textContent = '카메라를 켜는 중…';
    el.video.hidden = false;
    el.overlay.hidden = false;
    el.closeBtn.focus();
    startCamera();
  }

  function startCamera() {
    var gen = ++camGen; // 이번 호출의 세대 번호를 붙잡아둔다
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFail();
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (s) {
        // 기다리는 동안 닫았거나(오버레이 숨김) 이미 새로 열려서(세대 번호 불일치) 무효가 됐으면 바로 끔
        if (gen !== camGen || el.overlay.hidden) { stopTracks(s); return; }
        stream = s;
        el.video.srcObject = s;
        el.video.play().catch(function () {}); // 자동재생 거부 시 콘솔 오류 방지
        el.hint.textContent = '용지의 QR 코드를 화면에 비춰주세요';
        timer = setInterval(scanFrame, 300);
      })
      .catch(cameraFail);
  }

  function cameraFail() {
    // 권한 거부·카메라 없음·미지원 → 사진 폴백만 안내 (스펙 5절)
    el.video.hidden = true;
    el.hint.textContent = '카메라를 쓸 수 없어요. 아래 "사진에서 불러오기"로 QR이 찍힌 사진을 골라주세요.';
  }

  function scanFrame() {
    if (!stream || el.video.readyState < 2) return;
    var w = el.video.videoWidth, h = el.video.videoHeight;
    if (!w || !h) return;
    var text = decodeOn(el.video, w, h);
    if (text) finish(text);
  }

  function onFile() {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // 큰 사진은 줄여서 해독 (속도·메모리)
        var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        var text = decodeOn(img, Math.round(img.width * scale), Math.round(img.height * scale));
        if (text) finish(text);
        else el.hint.textContent = '사진에서 QR 코드를 찾지 못했어요. 초점이 맞은 사진으로 다시 시도해주세요.';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function decodeOn(source, w, h) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var code = window.jsQR ? jsQR(data.data, w, h) : null;
    return code && code.data ? code.data : null;
  }

  function finish(text) {
    var cb = onResult; // close()가 onResult를 지우므로 먼저 붙잡는다
    close();
    if (cb) cb(text);
  }

  function stopTracks(s) {
    s.getTracks().forEach(function (t) { t.stop(); });
  }

  function close() {
    camGen++; // 대기 중이던 이전 세대의 스트림 응답을 전부 무효화
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stopTracks(stream); stream = null; }
    el.video.srcObject = null;
    el.overlay.hidden = true;
    onResult = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  return { open: open };
})();
