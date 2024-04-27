import { PassElement } from "./pass"
import { pass_track_new_spotify_track } from "./passes/spotify"
import { pass_track_new_youtube_video } from "./passes/youtube"

export const passes: PassElement[] = [
	{ name: 'track.new.youtube_video', fn: pass_track_new_youtube_video },
	{ name: 'track.new.spotify_track', fn: pass_track_new_spotify_track },
]
