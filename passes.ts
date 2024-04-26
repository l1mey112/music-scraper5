import { PassElement } from "./pass"
import { pass_youtube_video_meta_youtube_video } from "./passes/youtube"

export const passes: PassElement[] = [
	{ name: 'youtube_video.meta.youtube_video', fn: pass_youtube_video_meta_youtube_video },
]
