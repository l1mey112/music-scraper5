import { pass_source_classify_chromaprint } from "./passes/chromaprint"
import { pass_image_download_image_url } from "./passes/image"
import { pass_track_merge_using_known_heuristics } from "./passes/merge_track"
import { pass_album_index_spotify_album, pass_artist_index_spotify_artist, pass_aux_assign_album_spotify_track, pass_aux_assign_track_spotify_artist, pass_track_index_spotify_track } from "./passes/spotify"
import { pass_source_download_from_spotify_track } from "./passes/spotify_download"
import { pass_aux_index_spotify_liked } from "./passes/spotify_liked"
import { pass_aux_spotify_artist0 } from "./passes/spotify_raw"
import { pass_aux_assign_track_youtube_channel, pass_aux_youtube_channel0, pass_artist_index_youtube_channel, pass_track_index_youtube_video, pass_aux_index_youtube_playlist } from "./passes/youtube"
import { pass_source_download_from_youtube_video } from "./passes/youtube_download"
import { MaybePromise, QueueEntry, is_never, static_assert, type_extends } from "./types"

export const pass_article_kinds = ['aux', 'track', 'album', 'artist', 'image', 'source', 'link'] as const

// all dispatchable pass article
export type PassArticle = typeof pass_article_kinds[number]
export type PassIdentifierTemplate = `${PassArticle}.${string}`
export type PassIdentifier = PassIdentifierList[number]

export type PassCallback<T = any> = (k: QueueEntry<T>[]) => MaybePromise<void>
export type PassSettledCallback = () => MaybePromise<void>

type PassIdentifierList = [
	'track.index_youtube_video',
	'artist.index_youtube_channel',
	'aux.assign_track_youtube_channel',
	'aux.youtube_channel0',
	'source.download_from_youtube_video',
	'source.download_from_spotify_track',
	'source.classify_chromaprint',
	'image.download_image_url',
	'aux.assign_track_spotify_artist',
	'track.index_spotify_track',
	'album.index_spotify_album',
	'artist.index_spotify_artist',
	'aux.assign_album_spotify_track',
	'aux.spotify_artist0',
	'aux.index_youtube_playlist',
	'aux.index_spotify_liked',
]

// PassIdentifierPayload<PassIdentifier> should equal unknown
export type PassIdentifierPayload<T extends PassIdentifier> =
	(typeof passes_const)[T]['pass'] extends PassCallback<infer U>
		? (is_never<U> extends true ? unknown : U)
		: never

type _ = static_assert<type_extends<PassIdentifierList, PassIdentifierTemplate[]>>

// TODO: passes should be able to be swapped out and registered.
//       which means, just declare payload types here globally,
//       then run a function to register them

const passes_const = {
	'track.index_youtube_video': { pass: pass_track_index_youtube_video },

	'artist.index_youtube_channel': { pass: pass_artist_index_youtube_channel },
	'aux.youtube_channel0': { pass: pass_aux_youtube_channel0 },
	'aux.index_youtube_playlist': { pass: pass_aux_index_youtube_playlist, settled: 'artist' },
	'aux.assign_track_youtube_channel': { pass: pass_aux_assign_track_youtube_channel, settled: 'artist' },	

	'track.index_spotify_track': { pass: pass_track_index_spotify_track },
	'album.index_spotify_album': { pass: pass_album_index_spotify_album },
	'artist.index_spotify_artist': { pass: pass_artist_index_spotify_artist },
	'aux.spotify_artist0': { pass: pass_aux_spotify_artist0 },
	'aux.assign_track_spotify_artist': { pass: pass_aux_assign_track_spotify_artist, settled: 'artist' },
	'aux.assign_album_spotify_track': { pass: pass_aux_assign_album_spotify_track, settled: 'track' },

	'image.download_image_url': { pass: pass_image_download_image_url },
	'source.classify_chromaprint': { pass: pass_source_classify_chromaprint },

	'aux.index_spotify_liked': { pass: pass_aux_index_spotify_liked },

	'source.download_from_spotify_track': { pass: pass_source_download_from_spotify_track },
	'source.download_from_youtube_video': { pass: pass_source_download_from_youtube_video },
} as const satisfies Record<PassIdentifier, PassDesc>

type PassSettledDesc = {
	pass: PassSettledCallback
	settled?: PassArticle // used with aux, scheduled to run after the all `settled.*` passes
}

export const passes: Record<PassIdentifier, PassDesc> = passes_const

type PassDesc = {
	pass: PassCallback
	settled?: PassArticle // used with aux, scheduled to run after the all `settled.*` passes
}

export const passes_settled: Record<PassIdentifierTemplate, PassSettledDesc> = {
	//'track.merge_using_known_heuristics': { pass: pass_track_merge_using_known_heuristics },
	//'link.classify_weak': { pass: pass_link_classify_weak },
	//'link.classify.link_shorteners': { pass: pass_link_classify_link_shorteners },
}
