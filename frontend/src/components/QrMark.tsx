import { View } from "react-native";

import { qrModules } from "../qr";

export function QrMark({ value, size = 168 }: { value: string; size?: number }) {
  const modules = qrModules(value);
  const quiet = 2;
  const cells = modules.length + quiet * 2;
  const cell = size / cells;
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: "#ffffff",
        flexDirection: "row",
        flexWrap: "wrap",
      }}
      accessibilityRole="image"
      accessibilityLabel={value}
    >
      {Array.from({ length: cells * cells }, (_, index) => {
        const row = Math.floor(index / cells) - quiet;
        const col = (index % cells) - quiet;
        const dark = row >= 0 && col >= 0 && row < modules.length && modules[row]?.[col] === true;
        return (
          <View
            key={index}
            style={{ width: cell, height: cell, backgroundColor: dark ? "#1f1a17" : "#ffffff" }}
          />
        );
      })}
    </View>
  );
}
