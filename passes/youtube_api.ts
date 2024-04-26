const YT_LEMNOS_URL = 'https://yt.lemnoslife.com'

// no batch operation, that is annoying
// i hate hammering the lemmnos api - it aint right
export async function meta_youtube_handle_to_id(handle: string): Promise<string | undefined> {
	if (!handle.startsWith('@')) {
		throw new Error(`youtube handle must start with @ (id: ${handle})`)
	}

	const resp = await fetch(`${YT_LEMNOS_URL}/noKey/channels&forHandle=${handle}&part=snippet`, {
		headers: {
			"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36",
		}
	})

	const json: any = await resp.json()
	if (json.pageInfo.totalResults === 0) {
		return undefined
	}

	return json.items[0].id
}

// 50 video ids in a batch
// returns a list of youtube video metadata, id if not found
export async function meta_youtube_video_v3(video_ids: string[]): Promise<(YoutubeVideo | string)[]> {
	if (video_ids.length > 50) {
		throw new Error(`youtube video req cannot have more than 50 ids (ids: ${video_ids.join(',')})`)
	}

	const resp = await fetch(`${YT_LEMNOS_URL}/noKey/videos?id=${video_ids.join(',')}&part=snippet,localizations`, {
		headers: {
			"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36",
		}
	})

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		throw new Error(`youtube video req failed`)
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

// lemnoslife doesn't provide display name
// youtube v3 doesn't provide links
//
// that explains the existence of
// - youtube_channel.meta.youtube_channel0
// - youtube_channel.meta.youtube_channel1

// does not return `display_name` - lemmnos yt API doesn't provide it
export async function meta_youtube_channel_lemmnos(channel_ids: string[]): Promise<(string | YoutubeChannelLemmnos)[]> {
	if (channel_ids.length > 50) {
		throw new Error(`youtube video req cannot have more than 50 ids (ids: ${channel_ids.join(',')})`)
	}

	const resp = await fetch(`${YT_LEMNOS_URL}/channels?id=${channel_ids.join(',')}&part=snippet,about`, {
		headers: {
			"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36",
		}
	})

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		throw new Error(`youtube channel req failed`)
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
				about: inner.about,
				images: inner.snippet,
			})
		}
	}

	return result
}

export async function meta_youtube_channel_v3(channel_ids: string[]): Promise<(string | YoutubeChannelV3)[]> {
	if (channel_ids.length > 50) {
		throw new Error(`youtube video req cannot have more than 50 ids (ids: ${channel_ids.join(',')})`)
	}

	const resp = await fetch(`${YT_LEMNOS_URL}/noKey/channels?part=snippet&id=${channel_ids.join(',')}`, {
		headers: {
			"User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36",
		}
	})

	if (!resp.ok) {
		console.error(await resp.text())
		console.error(resp.statusText)
		throw new Error(`youtube channel req failed`)
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

