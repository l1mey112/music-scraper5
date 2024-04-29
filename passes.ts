import { PassElement } from "./pass"
import { pass_source_classify_chromaprint } from "./passes/chromaprint"
import { pass_image_download_image_url } from "./passes/image"
import { pass_link_classify_link_shorteners, pass_link_classify_weak } from "./passes/link"
import { pass_link_extrapolate_from_linkcore, pass_link_extrapolate_from_lnk_to } from "./passes/link_distributors"
import { pass_track_merge_using_known_heuristics } from "./passes/merge_track"
import { pass_album_new_spotify_album, pass_artist_new_spotify_artist, pass_track_new_spotify_track } from "./passes/spotify"
import { pass_source_download_from_spotify_track } from "./passes/spotify_download"
import { pass_artist_meta_spotify_supplementary } from "./passes/spotify_raw"
import { pass_artist_index_youtube_channel, pass_artist_meta_youtube_channel_aux, pass_artist_new_youtube_channel, pass_track_new_youtube_video, pass_track_seed_youtube_playlist } from "./passes/youtube"
import { pass_source_download_from_youtube_video } from "./passes/youtube_download"

export const passes: PassElement[] = [
	[
		[
			[
				{ name: 'track.seed.youtube_playlist', fn: pass_track_seed_youtube_playlist },
				{ name: 'track.new.youtube_video', fn: pass_track_new_youtube_video },
				{ name: 'track.new.spotify_track', fn: pass_track_new_spotify_track },
			],
			{ name: 'album.new.spotify_album', fn: pass_album_new_spotify_album },
		],
		{ name: 'artist.new.youtube_channel', fn: pass_artist_new_youtube_channel },
		{ name: 'artist.new.spotify_artist', fn: pass_artist_new_spotify_artist },
		{ name: 'artist.meta.youtube_channel_aux', fn: pass_artist_meta_youtube_channel_aux },
		{ name: 'artist.meta.spotify_artist_supplementary', fn: pass_artist_meta_spotify_supplementary },
		{ name: 'artist.index.youtube_channel', fn: pass_artist_index_youtube_channel },
		[
			{ name: 'link.classify.weak', fn: pass_link_classify_weak },
			//{ name: 'link.classify.link_shorteners', fn: pass_link_classify_link_shorteners },
			//{ name: 'link.extrapolate.from_linkcore', fn: pass_link_extrapolate_from_linkcore },
			//{ name: 'link.extrapolate.from_lnk_to', fn: pass_link_extrapolate_from_lnk_to },
		],
	],
	{ name: 'image.download.image_url', fn: pass_image_download_image_url },
	{ name: 'source.download.from_youtube_video', fn: pass_source_download_from_youtube_video },
	{ name: 'source.download.from_spotify_track', fn: pass_source_download_from_spotify_track },
	{ name: 'source.classify.chromaprint', fn: pass_source_classify_chromaprint },
	{ name: 'track.merge.using_known_heuristics', fn: pass_track_merge_using_known_heuristics },
]
