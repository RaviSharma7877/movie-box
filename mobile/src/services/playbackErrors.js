export function playbackProblem(error) {
  const message = error?.message || "";
  if (error?.status === 429 || /\b429\b|limiting requests|busy and refusing/i.test(message)) {
    return { title: "Video server busy", message: "Wait a few minutes, then try again.", kind: "busy" };
  }
  if (/unavailable in (dub|sub) audio/i.test(message)) {
    const dub = /dub audio/i.test(message);
    return { title: dub ? "Dub unavailable" : "Original audio unavailable",
      message: dub ? "The provider doesn’t have a dubbed version of this episode." : "The provider doesn’t have the original audio for this episode.",
      kind: "audio" };
  }
  if (error?.status === 404 || /no matching anime|title is not available|anime episode is unavailable/i.test(message)) {
    return { title: "Video unavailable", message: "The provider doesn’t have a video for this title or episode.", kind: "missing" };
  }
  return { title: "Playback unavailable", message: message || "This video could not be played. Try again.", kind: "other" };
}

export function alternateAnimeAudio(request) {
  return request?.type === "anime" ? (request.audio === "Dub" ? "Sub" : "Dub") : null;
}

export const animeAudioLabel = audio => audio === "Dub" ? "Dubbed" : "Original audio";
