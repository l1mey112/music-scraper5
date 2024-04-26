import { PassElement } from "./pass"
import { pass_track_new_youtube_video } from "./passes/youtube"

export const passes: PassElement[] = [
	{ name: 'track.new.youtube_video', fn: pass_track_new_youtube_video },
]
