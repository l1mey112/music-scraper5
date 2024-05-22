import { nfetch } from "../fetch"
import { assert } from "../pass_misc"

const YT_LEMNOS_URL = 'https://yt.lemnoslife.com'

// check if https://www.youtube.com/shorts/{} redirects
export async function meta_youtube_video_is_short(video_id: string): Promise<boolean> {
	const resp = await nfetch(`https://www.youtube.com/shorts/${video_id}`)
	assert(resp.ok)
	return !resp.redirected
}

// no batch operation, that is annoying
// i hate hammering the lemmnos api - it aint right
export async function meta_youtube_handle_to_id(handle: string): Promise<string | undefined> {
	assert(handle.startsWith('@'))
	const resp = await nfetch(`${YT_LEMNOS_URL}/noKey/channels&forHandle=${handle}&part=snippet`)

	const json: any = await resp.json()
	if (json.pageInfo.totalResults === 0) {
		return undefined
	}

	return json.items[0].id
}

// 50 video ids in a batch
// returns a list of youtube video metadata, id if not found
export async function meta_youtube_video_v3(video_ids: string[]): Promise<(YoutubeVideo | string)[]> {
	assert(video_ids.length <= 50)
	const resp = await nfetch(`${YT_LEMNOS_URL}/noKey/videos?id=${video_ids.join(',')}&part=snippet,localizations`)

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		assert(false, 'youtube video req failed')
	}
	const json = await resp.json() as any

	if (!json.items) {
		json.items = []
	}

	// returned ids are in order
	// https://developers.google.com/youtube/v3/docs/videos#resource

	// construct array of YoutubeVideo | string (id on failure)
	// if an element fails, it simply wont be present in the returned array
	// you need to check for this
	const result: (YoutubeVideo | string)[] = []

	// avoid O(n^2) find() by using an index
	let i = 0
	for (const video_id of video_ids) {
		const inner = json.items[i]
		if (!inner || inner.id != video_id) {
			result.push(video_id)
		} else {
			// wouldn't happen
			// TODO: though there is a possibility if multiple of the same id is requested
			//       the entire thing would be thrown off and fucked up, though it would
			//       just need to retry a search going downwards
			inner.snippet.id = inner.id // attach id
			inner.snippet.localizations = inner.localizations // attach localizations
			result.push(inner.snippet)
			i++
		}
	}

	return result
}

export async function meta_youtube_video_status_lemmnos(video_ids: string[]): Promise<(YoutubeVideoStatus | string)[]> {
	assert(video_ids.length <= 50)
	const resp = await nfetch(`${YT_LEMNOS_URL}/videos?id=${video_ids.join(',')}&part=short,music`)

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		assert(false, 'youtube video req failed')
	}
	const json = await resp.json() as any

	const result: (YoutubeVideoStatus | string)[] = []

	if (!json.items) {
		json.items = []
	}

	const map = new Map<string, any>()
	for (const inner of json.items) {
		map.set(inner.id, inner)
	}

	for (const video_id of video_ids) {
		const inner = map.get(video_id)
		if (!inner) {
			result.push(video_id)
		} else {
			result.push({
				music_available: inner.music.available,
				short_available: inner.short.available,
			})
		}
	}

	return result
}

// lemnoslife doesn't provide display name
// youtube v3 doesn't provide links
//
// that explains the existence of
// - youtube_channel.meta.youtube_channel0
// - youtube_channel.meta.youtube_channel1

// does not return `display_name` - lemmnos yt API doesn't provide it
export async function meta_youtube_channel_lemmnos(channel_ids: string[]): Promise<(string | YoutubeChannelLemmnos)[]> {
	assert(channel_ids.length <= 50)
	const resp = await nfetch(`${YT_LEMNOS_URL}/channels?id=${channel_ids.join(',')}&part=snippet,about`)

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		assert(false, 'youtube channel req failed')
	}
	const json = await resp.json() as any

	const result: (YoutubeChannelLemmnos | string)[] = []

	if (!json.items) {
		json.items = []
	}

	const map = new Map<string, any>()
	for (const inner of json.items) {
		map.set(inner.id, inner)
	}

	for (const channel_id of channel_ids) {
		const inner = map.get(channel_id)
		if (!inner) {
			result.push(channel_id)
		} else {
			// trim the fat
			delete inner.about.stats
			for (const link of inner.about.links) {
				delete link.favicon
			}

			result.push({
				id: inner.id,
				about: inner.about,
				images: inner.snippet,
			})
		}
	}

	return result
}

export async function meta_youtube_channel_v3(channel_ids: string[]): Promise<(string | YoutubeChannelV3)[]> {
	assert(channel_ids.length <= 50)
	const resp = await nfetch(`${YT_LEMNOS_URL}/noKey/channels?part=snippet&id=${channel_ids.join(',')}`)

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		assert(false, 'youtube channel req failed')
	}
	const json = await resp.json() as any

	const result: (YoutubeChannelV3 | string)[] = []

	if (!json.items) {
		json.items = []
	}

	const map = new Map<string, any>()
	for (const inner of json.items) {
		map.set(inner.id, inner.snippet)
	}

	for (const channel_id of channel_ids) {
		const inner = map.get(channel_id)
		if (!inner) {
			result.push(channel_id)
		} else {
			result.push(inner)
		}
	}

	return result
}

export async function meta_youtube_channel_playlist(playlist_id: string): Promise<string[]> {
	type Resp = {
		nextPageToken?: string | undefined
		error: unknown
		items: {
			contentDetails: {
				videoId: string
			}
		}[]
	}

	const ids = []

	let lastresp: Resp | undefined | null
	do {
		const resp = await nfetch(`${YT_LEMNOS_URL}/noKey/playlistItems?part=contentDetails&playlistId=${playlist_id}&maxResults=50${lastresp ? `&pageToken=${lastresp.nextPageToken}` : ''}`)
		lastresp = await resp.json() as Resp

		if (!resp.ok || !lastresp.items || lastresp.error) {
			console.error(lastresp)
			console.error(resp.statusText)
			assert(false, 'youtube playlist req failed')
		}

		ids.push(...lastresp.items.map(x => x.contentDetails.videoId))
	} while (lastresp.nextPageToken)

	return ids
}

export type YoutubeVideoStatus = {
	music_available: boolean
	short_available: boolean
}

export type YoutubeImage = {
	url: string
	width: number
	height: number
}

export type YoutubeVideo = {
	id: string
	publishedAt: string
	channelId: string
	title: string
	description: string
	thumbnails: {
		[key: string]: YoutubeImage // key being "default" | "medium" | "high" | "standard" | "maxres" | ...
	}
	channelTitle: string
	tags: string[]
	categoryId: string
	liveBroadcastContent: string
	localized: {
		title: string
		description: string
	}
	defaultLanguage?: string
	defaultAudioLanguage?: string
	localizations?: {
		[key: string]: {
			title: string
			description: string
		}
	}
}

type YoutubeChannelAboutLink = {
	url: string   // "https://open.spotify.com/artist/3b7jPCedJ2VH4l4rcOTvNC"
	title: string // "Spotify"
}

// snippet
type YoutubeChannelV3 = {
	title: string
	description: string
	customUrl: string
	publishedAt: string
	thumbnails: {
		default: {
			url: string
			width: number
			height: number
		}
		medium: {
			url: string
			width: number
			height: number
		}
		high: {
			url: string
			width: number
			height: number
		}
	}
	localized: {
		title: string
		description: string
	}
	country?: string
}

export type YoutubeChannelLemmnos = {
	id: string
	about: {
		description?: string | undefined
		details: {
			location: string
		}
		links: YoutubeChannelAboutLink[]
		handle: string // @pinocchiop
	}
	images: {
		avatar: YoutubeImage[] | null
		banner: YoutubeImage[] | null
		tvBanner: YoutubeImage[] | null
		mobileBanner: YoutubeImage[] | null
	}
}

