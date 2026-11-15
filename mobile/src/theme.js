import { StyleSheet } from "react-native";
export const colors = {
  background: "#232226",
  surface: "#2E2D32",
  raised: "#3A393F",
  border: "#4D4C53",
  text: "#FAF9FC",
  muted: "#C5C2C9",
  accent: "#EC1830",
  ink: "#FFFFFF",
  error: "#FFA69E",
  success: "#99D6B0",
};
export const displayFont = "System";
export const episodeColors = {
  watched: { background: "#263832", border: "#4F7664", text: "#ADD0BC" },
  lastPlayed: { background: "#29364F", border: "#617AAA", text: "#B8C9F6" },
};
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 36,
    lineHeight: 43,
    fontWeight: "800",
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "600",
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  label: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 2,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 24 },
});
