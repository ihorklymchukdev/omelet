import qrcode from "qrcode-generator";

// Drawn as one SVG path of dark modules, so nothing is injected as markup.
export function Qr({ value, size = 184 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = count + quiet * 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} role="img" aria-label="QR code for the sign-in page" shapeRendering="crispEdges">
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
