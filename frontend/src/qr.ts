import { create } from "qrcode";

export function qrModules(text: string): boolean[][] {
  const code = create(text, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  const rows: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) {
      line.push(code.modules.get(row, col) === 1);
    }
    rows.push(line);
  }
  return rows;
}
