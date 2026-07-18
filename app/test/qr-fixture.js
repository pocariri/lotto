// qr-fixture.js — 테스트 전용: 문자열 → QR 코드가 그려진 24비트 BMP 버퍼 (의존성 없음).
// browser-test가 이 이미지를 "사진에서 불러오기" 입력에 넣어 QR 해독 경로를 자동 검증한다.
const qrcode = require('./vendor/qrcode-generator.js');

function makeQrBmp(text, cell = 8, margin = 4) {
  const qr = qrcode(0, 'M'); // 타입 자동, 오류정정 M
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cell;
  const rowBytes = Math.ceil(size * 3 / 4) * 4; // BMP 행은 4바이트 배수
  const dataSize = rowBytes * size;
  const buf = Buffer.alloc(54 + dataSize, 0);
  buf.fill(0xff, 54); // 픽셀 영역은 흰색으로
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);      // 픽셀 시작
  buf.writeUInt32LE(40, 14);      // BITMAPINFOHEADER
  buf.writeInt32LE(size, 18);
  buf.writeInt32LE(size, 22);     // 양수 = 아래→위 저장
  buf.writeUInt16LE(1, 26);       // planes
  buf.writeUInt16LE(24, 28);      // 24bpp
  buf.writeUInt32LE(dataSize, 34);
  for (let y = 0; y < size; y++) {          // y: 위에서부터
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / cell) - margin;
      const col = Math.floor(x / cell) - margin;
      const dark = row >= 0 && row < n && col >= 0 && col < n && qr.isDark(row, col);
      if (dark) {
        const off = 54 + (size - 1 - y) * rowBytes + x * 3;
        buf[off] = 0; buf[off + 1] = 0; buf[off + 2] = 0;
      }
    }
  }
  return buf;
}

module.exports = { makeQrBmp };
