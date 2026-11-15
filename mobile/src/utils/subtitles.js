export function formatSubtitleText(text) {
  // Some providers leave ASS hard line breaks in otherwise plain subtitle text.
  return text.replace(/\\N/g, "\n");
}
